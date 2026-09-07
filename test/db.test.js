const test = require('node:test');
const assert = require('node:assert/strict');
const { RunStore } = require('../server/db');

test('missing MongoDB leaves gameplay persistence optional', async () => {
  assert.equal(await new RunStore('').saveRun({}), false);
});

test('MongoDB connection and write failures resolve without crashing', async () => {
  const invalid = new RunStore('invalid-uri');
  assert.equal(await invalid.saveRun({}), false);
  assert.equal(invalid.disabled, true);
  await invalid.close();
  const failedWrite = new RunStore('mongodb://localhost/test');
  failedWrite.collection = { insertOne: async () => { throw new Error('Test write failure'); } };
  assert.equal(await failedWrite.saveRun({}), false);
  assert.equal(failedWrite.disabled, true);
});
