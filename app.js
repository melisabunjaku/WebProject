const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const port = 5000;
const imagePath = path.join('/usr/src/app/cache', 'image.jpg');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use('/web', express.static(path.join(__dirname, 'cache')));
app.use('/public', express.static(path.join(__dirname, 'public')));

fs.mkdirSync(path.dirname(imagePath), { recursive: true });

const downloadImageIfNeeded = async () => {
  try {
    const now = Date.now();
    if (fs.existsSync(imagePath)) {
      const stats = fs.statSync(imagePath);
      const ageMinutes = (now - stats.mtimeMs) / (1000 * 60);
      if (ageMinutes < 60) return;
    }

    const response = await axios({
      method: 'get',
      url: 'https://picsum.photos/1200',
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(imagePath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (err) {
    console.error('Failed to download image:', err);
  }
};

const renderHtml = (todos, newTodo = null) => `
  <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 20px;
          background-color: #f4f4f9;
        }
        h1 {
          color: #333;
        }
        h2 {
          color: #444;
        }
        img {
          max-width: 100%;
          height: auto;
          margin-bottom: 20px;
        }
        form {
          margin-bottom: 20px;
        }
        input[type="text"] {
          padding: 10px;
          width: 250px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        button {
          padding: 10px 15px;
          background-color: #4CAF50;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        button:hover {
          background-color: #45a049;
        }
        ul {
          list-style-type: none;
          padding: 0;
        }
        li {
          background-color: #e2e2e2;
          margin: 5px 0;
          padding: 10px;
          border-radius: 4px;
        }
        li:nth-child(even) {
          background-color: #f8f8f8;
        }
        .todo-list {
          max-width: 500px;
          margin: 0 auto;
        }
      </style>
    </head>
    <body>
      <div class="todo-list">
        <h1>To-Do List</h1>
        <img src="/web/image.jpg" alt="Random Image">
        <form id="todoForm">
          <input type="text" id="todoInput" name="todo" placeholder="Enter a todo (max 140 characters)" maxlength="140" required>
          <button type="submit">Add Todo</button>
        </form>

        ${newTodo ? `<h2>Your submitted todo: <em>${newTodo}</em></h2>` : ''}

      <h2>Existing Todos</h2>
<ul id="todoList">
  ${todos.map(todo => `<li>${todo.task || todo}</li>`).join('')}
</ul>

 <script>
  const todoList = document.getElementById('todoList');
  const todoInput = document.getElementById('todoInput');
  const form = document.getElementById('todoForm');
  const errorMessage = document.createElement('p');
  errorMessage.style.color = 'red';
  form.appendChild(errorMessage);

  async function fetchTodos() {
    const response = await fetch('/todos');
    if (response.ok) {
      const data = await response.json();
      todoList.innerHTML = data.map(todo => \`<li>\${todo.task}</li>\`).join('');
    }
  }

  fetchTodos();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const todoInputValue = todoInput.value;
    errorMessage.textContent = '';

    if (todoInputValue.length > 140) {
      errorMessage.textContent = 'Todo is too long. Max length is 140 characters.';
      return;
    }

    const response = await fetch('/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todo: todoInputValue })
    });

    if (response.ok) {
      const data = await response.json();
      todoList.innerHTML = data.todos.map(todo => \`<li>\${todo.task}</li>\`).join('');
      todoInput.value = '';
    } else {
      const errorData = await response.json();
      errorMessage.textContent = errorData.error || 'An error occurred. Please try again.';
    }
  });
</script>
    </body>
  </html>
`;


app.get('/web', async (req, res) => {
  await downloadImageIfNeeded();

  let todos = [];
  try {
    const response = await axios.get('http://localhost:5001/todos');
    todos = response.data;
  } catch (err) {
    console.error('Error fetching todos:', err.message);
  }

  const newTodo = req.query.new || null;
  res.send(renderHtml(todos, newTodo));
});

app.listen(port, () => {
  console.log(`Project running on port ${port}`);
});
