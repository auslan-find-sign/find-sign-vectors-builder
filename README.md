# find-sign-vectors-builder

This tool builds the V5 Word Vector Library for Find Sign's english word search interface. It works by converting a Facebook FastText text format vector dataset in to a much more compressed binary format.

## How it works

info.json provides some important information, mainly `shardBits` and `vectorSize`.

When looking up a word, the following transformations are done:

1. If the word is entirely uppercase, it's presumed to be an acronym, and left unchanged. Otherwise, the word is lowercased.
2. The normalized word is hashed with sha256, and the output of that hash is converted to base2 binary, and the first `shardBits` bits of the resulting hash are interpreted as an unsigned integer, `shardNumber`.
3. The file `[shardNumber].lps` is loaded, and checked for a matching word entry.

If a matching word is found, the vector is reconstituted and returned

## `[shardNumber].lps` format

The LPS files are a length prefix stream. That is, they are buffers prefixed with a varint length. LPS files produced by this tool always contain a multiple of 3 entries. These are in sequence repeated:

1. A utf-8 string normalized word `normalizedWord`.
2. a 32bit big endian float `scale`
3. a buffer which is `vectorSize` many bytes long. Each byte is a value between 0 and 255 unsigned, which maps to `-1.0` to `+1.0` multiplied by `scale`

## So what's the point of this?

If you wanted to setup a find-sign instance which deals in a non-english language, this tool would be a great starting point. Facebook Research has already published 157 [compatible datasets](https://fasttext.cc/docs/en/crawl-vectors.html). Convert one of these languages, stick it on a static http server somewhere, and you're one step closer to having Find Sign working.

You can find the cc.en.300 dataset converted in to this format at [data.auslan.fyi](https://data.auslan.fyi/collections/wordvec) as used by find-sign-website.