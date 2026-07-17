import { config } from 'dotenv'
config({ path: '.env.local' })

import { Client } from 'pg'

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

client
  .connect()
  .then(() => {
    console.log('CONECTADO CORRECTAMENTE')
    return client.end()
  })
  .catch((err) => {
    console.log('ERROR COMPLETO:', err)
  })
