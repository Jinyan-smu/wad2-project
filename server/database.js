require('dotenv').config({ path: require('path').join(__dirname, '.env') })

const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Add the Supabase connection string to server/.env.')
}

const connectionUrl = new URL(process.env.DATABASE_URL)
connectionUrl.searchParams.delete('sslmode')
connectionUrl.searchParams.delete('sslrootcert')
connectionUrl.searchParams.delete('sslcert')
connectionUrl.searchParams.delete('sslkey')

const pool = new Pool({
  connectionString: connectionUrl.toString(),
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl: {
    ca: fs.readFileSync(path.join(__dirname, 'certs', 'prod-ca-2021.crt'), 'utf8'),
    rejectUnauthorized: true
  }
})

async function query(text, values) {
  return pool.query(text, values)
}

async function withTransaction(task) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await task(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function close() {
  await pool.end()
}

module.exports = { query, withTransaction, close }
