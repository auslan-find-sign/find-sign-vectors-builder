// Reads FastText .vec text formast word embedding data file line by line and writes it in to
// a binary vector library, indexed by hash of the written word text, organized in to small
// files of about 8-16kb each, which can be efficiently loaded as needed by web clients or
// local apps as needed for each word lookup. By default, each vector's value is stored with
// 8 bits of integer precision, with each vector scaled as needed to fit in to that space.
// Resolution can be adjusted to an arbitrary number of bits below in the resolutionBits constant
import crypto from 'node:crypto'
import fs from 'fs/promises'
import zlib from 'zlib'
import byline from 'byline'
import fetch from 'node-fetch'
import ProgressBar from 'progress'
// length prefixed streaming encoder and decoder
import * as lp from 'it-length-prefixed'

const maxEntries = 500000
const shardBits = 13
const version = 5

function normalizeWord (word) {
  if (word.length > 1 && word.match(/^[A-Z0-9]$/)) {
    return word.trim()
  } else {
    return word.trim().toLowerCase()
  }
}

function pickBucket (word) {
  const hash = crypto.createHash('sha256')
  hash.update(word)
  const byteCount = Math.ceil(shardBits / 8)
  const bytes = hash.digest().slice(0, byteCount)
  const binary = [...bytes].map(x => `00000000${x.toString(2)}`.slice(-8)).join('')
  const shardBitString = binary.slice(0, shardBits)
  const numLimited = parseInt(shardBitString, '2')
  return numLimited
}


async function run (fasttextPath, outputPath) {
  console.log(fasttextPath)

  await fs.mkdir(outputPath, { recursive: true })

  const previouslySeen = new Set()

  const outputFiles = {}

  // open the supplied ascii fasttext model
  // let inputFile = fs.createReadStream(fasttextPath)
  const response = await fetch(fasttextPath)
  let inputFile = response.body
  // if it's still gzipped, use zlib to stream unzip it along the way
  if (fasttextPath.match(/\.gz$/)) {
    const unzip = zlib.createGunzip()
    inputFile = inputFile.pipe(unzip)
  }
  // now pipe it through byline to get lines out
  const lineStream = byline.createStream(inputFile)

  const textEncoder = new TextEncoder()

  let count = 0
  var progress = new ProgressBar(' [:bar] :rate/wps :percent :etas :word', {
    total: maxEntries, width: 80, head: '>', incomplete: ' ', clear: true
  })

  try {
    for await (const line of lineStream) {
      if (count >= maxEntries) {
        lineStream.destroy()
        progress.terminate()
        continue
      } else {
        const elements = line.toString().replace('\n', '').split(' ')

        if (elements.length === 2) {
          const [totalWords, vectorSize] = elements.map(n => parseInt(n))
          console.log(`Starting transfer from vector library containing ${totalWords} words with vector size of ${vectorSize}`)

          await fs.writeFile(`${outputPath}/info.json`, JSON.stringify({
            version,
            shardBits,
            entries: Math.min(totalWords, maxEntries),
            vectorSize,
            source: fasttextPath,
            built: (new Date()).toISOString()
          }, null, 2))
        } else {
          const word = normalizeWord(elements.shift())

          if (previouslySeen.has(word)) {
            continue
          } else {
            previouslySeen.add(word)

            const vector = elements.map(x => parseFloat(x))
            const scaling = Math.max(...vector.map(x => Math.abs(x)))
            const scaledVector = vector.map(x => x / scaling)
            const discretizedVector = scaledVector.map(x => {
              const value = ((x + 1.0) / 2.0) * 255
              return Math.round(value)
            })

            const scalingData = new DataView(new ArrayBuffer(4))
            scalingData.setFloat32(0, scaling)

            const wordBuffer = textEncoder.encode(word)
            const scalingBuffer = new Uint8Array(scalingData.buffer)
            const vectorBuffer = new Uint8Array(discretizedVector)

            const bucket = pickBucket(word)
            const filename = `${outputPath}/${bucket}.lps`
            if (!outputFiles[filename]) outputFiles[filename] = []
            outputFiles[filename].push(new Uint8Array([
              ...lp.encode.single(wordBuffer).slice(),
              ...lp.encode.single(scalingBuffer).slice(),
              ...lp.encode.single(vectorBuffer).slice()
            ]))

            count += 1
            if (count % 1000 === 0) progress.interrupt(`count: ${count}, word: ${word}`)
            progress.tick({ word })
          }
        }
      }
    }
  } catch (err) {
    if (err.code && err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      console.log('Stream terminated')
    } else {
      throw err
    }
  }

  console.log('Finishing up...')

  const fileCount = Object.keys(outputFiles).length
  const fileWriteProgress = new ProgressBar(' [:bar] :rate/wps :percent :etas :file', {
    total: fileCount, width: 80, head: '>', incomplete: ' ', clear: true
  })

  for (const filename in outputFiles) {
    const data = new Uint8Array([...outputFiles[filename].map(x => [...x]).flat()])
    await fs.writeFile(filename, data)
    fileWriteProgress.tick({ file: filename })
  }
  progress.terminate()

  console.log('Vector Library Build Complete!')
}

run(...process.argv.slice(-2))
