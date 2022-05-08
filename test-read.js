import crypto from 'node:crypto'
import fs from 'fs/promises'
import fsOld from 'fs'
import zlib from 'zlib'
// length prefixed streaming encoder and decoder
import * as lp from 'it-length-prefixed'

function normalizeWord (word) {
  if (word.length > 1 && word.match(/^[A-Z0-9]$/)) {
    return word.trim()
  } else {
    return word.trim().toLowerCase()
  }
}

function pickBucket (word, shardBits) {
  const hash = crypto.createHash('sha256')
  hash.update(word)
  const byteCount = Math.ceil(shardBits / 8)
  const bytes = hash.digest().slice(0, byteCount)
  const binary = [...bytes].map(x => `00000000${x.toString(2)}`.slice(-8)).join('')
  const shardBitString = binary.slice(0, shardBits)
  const numLimited = parseInt(shardBitString, '2')
  return numLimited
}


async function run (dataPath, word) {
  const info = JSON.parse((await fs.readFile(`${dataPath}/info.json`)).toString())
  const normalWord = normalizeWord(word)
  const bucket = pickBucket(normalWord, info.shardBits)

  const file = fsOld.createReadStream(`${dataPath}/${bucket}.lps`)
  const entries = []
  for await (const item of lp.decode()(file)) {
    entries.push(item)
  }

  while (entries.length) {
    const entryWord = Buffer.from(entries.shift()).toString('utf-8')
    const scaling = Buffer.from(entries. shift()).readFloatBE(0)
    const scaledVector = entries.shift()
    if (entryWord === normalWord) {
      console.log('Entry:', entryWord)
      console.log('Vector Scaling:', scaling)
      console.log('Vector Data', scaledVector)

      const reconstituted = [...scaledVector].map(x => (((x / 255) * 2.0) - 1.0) * scaling)
      console.log('Reconstituted Vector:', reconstituted)
    }
  }
}

run(...process.argv.slice(-2))
