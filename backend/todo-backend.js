const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const axios = require('axios');
const cron = require('node-cron');
const winston = require('winston');
const { connect, StringCodec } = require('nats'); // <-- modern NATS

const app = express();
const port = process.env.PORT || 5001;

// Setup logger
const logger = winston.createLogger({
  level: 'info',
  transports: [new winston.transports.Console()]
});

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: 5432,
});

// NATS Setup
let nc; // NATS connection
const sc = StringCodec(); // String encoder/decoder

async function connectToNats() {
  try {
    nc = await connect({ servers: process.env.NATS_URL || 'nats://localhost:4222' });
    logger.info('Connected to NATS');
  } catch (err) {
    logger.error('Failed to connect to NATS:', err);
    setTimeout(connectToNats, 5000); // Retry after 5s
  }
}

// Initial connect
connectToNats();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use((req, res, next) => {
  logger.info(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - Body: ${JSON.stringify(req.body || {})}`);
  next();
});

// Health check
app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Health check failed:', err);
    res.status(500).send('Database connection failed');
  }
});

// GET todos
app.get('/todos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM todos ORDER BY id ASC');
    res.status(200).json(result.rows);
  } catch (err) {
    logger.error('Error fetching todos:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/todos', async (req, res) => {
  const { todo } = req.body;
  if (!todo || todo.length > 140) return res.status(400).json({ error: 'Invalid todo' });

  try {
    const insertResult = await pool.query(
      'INSERT INTO todos(task) VALUES($1) RETURNING *',
      [todo]
    );

    const newTodo = insertResult.rows[0];
    logger.info(`New todo added: "${newTodo.task}"`);

    res.status(201).json({ message: 'Todo added', todos: [newTodo] });  // Return the todos array with the new todo
  } catch (err) {
    logger.error('Error inserting todo:', err);
    res.status(500).json({ error: 'DB error' });
  }
});


// PUT todo (mark as done)
app.put('/todos/:id', async (req, res) => {
  const { id } = req.params;
  const { done } = req.body;
  if (typeof done !== 'boolean') return res.status(400).json({ error: 'Invalid done field' });

  try {
    const result = await pool.query('UPDATE todos SET done = $1 WHERE id = $2 RETURNING *', [done, id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Todo not found' });

    const updatedTodo = result.rows[0];
    logger.info(`Todo ${id} updated: done = ${done}`);

    // Publish updated todo to NATS
    if (nc) {
      nc.publish('todo.updated', sc.encode(JSON.stringify({
        id: updatedTodo.id,
        task: updatedTodo.task,
        done: updatedTodo.done
      })));
      logger.info(`Published todo.updated event: ${JSON.stringify(updatedTodo)}`);
    }

    res.status(200).json({ message: 'Todo updated', todo: updatedTodo });
  } catch (err) {
    logger.error('Error updating todo:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// CronJob to fetch random Wikipedia article
function startCronJob() {
  cron.schedule('0 * * * *', async () => {
    logger.info(`[${new Date().toISOString()}] Cron job: Fetching a random Wikipedia article`);
    try {
      const response = await axios.get('https://en.wikipedia.org/wiki/Special:Random', {
        maxRedirects: 0,
        validateStatus: status => status >= 300 && status < 400
      });

      const articleUrl = response.headers.location;
      const task = `Read ${articleUrl}`;

      // Insert the Wikipedia article task into the database
      await pool.query('INSERT INTO todos(task) VALUES($1)', [task]);
      logger.info(`Cron job: New todo added: ${task}`);

      // Publish the task to NATS
      if (nc) {
        nc.publish('todo.created', sc.encode(JSON.stringify({ task })));
        logger.info(`Published cron-generated todo.created event: ${task}`);
      }
    } catch (err) {
      logger.error('Cron job error fetching Wikipedia article:', err.message);
    }
  });

  logger.info('Hourly CronJob started');
}

startCronJob();

app.listen(port, () => {
  logger.info(`Todo backend running on port ${port}`);
});
