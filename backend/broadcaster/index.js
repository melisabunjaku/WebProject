require('dotenv').config();
const { connect, StringCodec } = require('nats');
const axios = require('axios');

const sc = StringCodec();

async function start() {
  console.log('Connecting to NATS...');
  const nc = await connect({ servers: process.env.NATS_URL });
  console.log('✅ Connected to NATS server:', process.env.NATS_URL);
  
  const sub = nc.subscribe('todo.created');
  const sub2 = nc.subscribe('todo.updated');

  console.log('Subscribed to todo.created and todo.updated');

  handleSubscription(sub, 'todo.created');
  handleSubscription(sub2, 'todo.updated');
}

async function handleSubscription(sub, eventType) {
  console.log(`Listening for ${eventType} events...`);
  
  for await (const m of sub) {
    const raw = sc.decode(m.data);
    console.log(` Received ${eventType}: ${raw}`);

    try {
      const parsed = JSON.parse(raw); 
      
      if (eventType === 'todo.created') {
        await sendToSlack(`New todo created: ${parsed.task}`);
      } else if (eventType === 'todo.updated') {
        await sendToSlack(`Todo updated: ${parsed.task} (done: ${parsed.done})`);
      }
    } catch (err) {
      console.error(`Error parsing message for ${eventType}:`, err.message);
    }
  }
}

async function sendToSlack(text) {
  console.log('➡️ Sending message to Slack:', text);

  try {
    await axios.post(process.env.SLACK_WEBHOOK_URL, { text });
    console.log('Message sent to Slack successfully!');
  } catch (error) {
    console.error('Error sending to Slack:', error.message);
  }
}

start();
