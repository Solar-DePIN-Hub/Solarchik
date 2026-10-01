# Metaplex Core reference bytes

`CoreIxTest` compares the hand-encoded Kotlin CreateV1 against bytes produced by
`@metaplex-foundation/mpl-core` (1.10.x) and `@solana/web3.js` 1.x for the same inputs.

```
npm i @metaplex-foundation/mpl-core@^1.10.0 @metaplex-foundation/umi@^1.6.0 \
      @metaplex-foundation/umi-bundle-defaults@^1.6.0 @solana/web3.js@1
node ref1.mjs   # PRO-style name, 3 attributes (instruction data + account metas)
node ref2.mjs   # FREE: data, and a full legacy message (transfer + createV1)
node ref3.mjs   # production plugin set (7 attributes) + full PRO message
```
