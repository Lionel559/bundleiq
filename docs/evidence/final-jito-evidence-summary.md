# BundleIQ Final Judge Evidence Export

Generated from private local evidence at `.data/jito-evidence.json`. Raw `.data/` evidence remains ignored by Git.

## Final Observed Result

31 real Jito testnet bundles landed and were status-checked.

Bundle ID alone was not treated as success; status was checked separately. Yellowstone is not configured and remains reported as missing/RPC fallback.

## Summary

- Generated at: `2026-06-08T16:45:07.219Z`
- Raw real Jito records: 63
- Landed real Jito bundles: 31
- Unique bundles with status checks: 62
- Total status-check attempts: 76
- Landed status-check attempts: 31
- Landed slots recorded: 31
- Failed/network-error operational records in raw evidence: 31
- Yellowstone: not configured; RPC fallback only

## Judge Notes

- All 31 exported records have `latestStatus: landed`, `checkedAt`, and `landedSlot`.
- The private raw evidence source contains 62 unique bundles with separate status checks and 76 total status-check attempts.
- Network-error and failed records remain failed operational evidence and are not counted as landed.
- This export excludes secret keys, signed transaction bytes, raw status payloads, and `.env.local` contents.
- Raw `.data/` evidence remains private and ignored by Git.

## Final 31 Landed Jito Testnet Bundles

| Bundle ID | Network | Submitted At | Checked At | Latest Status | Landed Slot | Confirmation | Tip Lamports | Transaction Count |
| --- | --- | --- | --- | --- | ---: | --- | ---: | ---: |
| 0aa54bcd7c5b71293894065ac14a985a80d6f976f49d53cd7ea439c8c32e6992 | testnet | 2026-06-07T22:09:23.061Z | 2026-06-07T22:09:28.105Z | landed | 413832556 | confirmed | 1000 | 1 |
| 8aa17284ab263b862efc60323e42563b1dc19529fd627bbd2e159ab1b5a54916 | testnet | 2026-06-07T22:22:56.149Z | 2026-06-07T22:23:01.192Z | landed | 413834680 | confirmed | 1000 | 1 |
| 1037f9faadcdc53280331369e86c8bf470741525d7871687050a016b5c50e2f8 | testnet | 2026-06-07T22:23:12.088Z | 2026-06-07T22:23:17.170Z | landed | 413834712 | confirmed | 1000 | 1 |
| 062c72c378e0dcfeb0d392705e1b0fa7efdb461e7b93be3f501370714bef0bdb | testnet | 2026-06-07T22:23:20.299Z | 2026-06-07T22:23:26.210Z | landed | 413834732 | confirmed | 1000 | 1 |
| 7bf70ab8da7f53b97314fa935290cdeec42b96fd0ada8d1143e51ebadbd76bff | testnet | 2026-06-07T22:23:38.464Z | 2026-06-07T22:23:44.219Z | landed | 413834772 | confirmed | 1000 | 1 |
| 36bc302acaa2de55c4cc31af9235093b095c96e0305646663f9a0bad41765e46 | testnet | 2026-06-07T22:45:04.470Z | 2026-06-07T22:45:18.266Z | landed | 413838136 | confirmed | 1000 | 1 |
| df802069b96be502c85c9db514ae0224151b00d1c7fca464934b0b15ba2401ea | testnet | 2026-06-07T22:45:55.216Z | 2026-06-07T22:46:06.917Z | landed | 413838276 | confirmed | 1000 | 1 |
| 9a18394c0911baba1a5d554e4ab8656431ff067fdedad4fb802d71ce387fc80d | testnet | 2026-06-07T22:46:10.110Z | 2026-06-07T22:46:15.169Z | landed | 413838284 | confirmed | 1000 | 1 |
| 19fbb5fa68922efc1596817007cc07e1512a7352cdd28a3105d8303e159a5029 | testnet | 2026-06-07T22:46:18.331Z | 2026-06-07T22:46:23.398Z | landed | 413838304 | confirmed | 1000 | 1 |
| 726c4e062c691fb3975984b357679285f8d2479167ed7a3ff174bfe818a0baa4 | testnet | 2026-06-07T22:46:26.699Z | 2026-06-07T22:46:31.771Z | landed | 413838332 | confirmed | 1000 | 1 |
| 33b1718c6b1c2ff8fc6dc403641e1dd05d96aa1318f1ff7f2c06ef2640ead99c | testnet | 2026-06-07T22:46:38.503Z | 2026-06-07T22:46:43.550Z | landed | 413838360 | confirmed | 1000 | 1 |
| 675b7f8e182570278175aecfc6f520d77fe20d00aea32cd24f4d9d1d038de690 | testnet | 2026-06-08T14:22:07.687Z | 2026-06-08T14:22:27.513Z | landed | 413986180 | confirmed | 1000 | 1 |
| 2082b8f48b692e5747929a591044992432ab2a70234cb35f8b24927a1b096717 | testnet | 2026-06-08T14:22:38.673Z | 2026-06-08T14:22:43.757Z | landed | 413986220 | confirmed | 1000 | 1 |
| 134aba7a4036da09581b169e25e3fe1b36d1d0ab847a498f369e93335c6dea3e | testnet | 2026-06-08T14:22:51.146Z | 2026-06-08T14:23:03.419Z | landed | 413986280 | confirmed | 1000 | 1 |
| ca8791be684d89bf3cbf56175353ff141af0226025726194ac167fc412540276 | testnet | 2026-06-08T14:23:08.869Z | 2026-06-08T14:23:13.942Z | landed | 413986285 | confirmed | 1000 | 1 |
| 7e24feb2222858ee07b0197cf8eb55bd7da649c035c05f015ba4fd5aa278d089 | testnet | 2026-06-08T14:23:18.804Z | 2026-06-08T14:23:23.876Z | landed | 413986312 | confirmed | 1000 | 1 |
| fef07fd8b0730388fe71de792993332a42d749bffbed4d80aeabed12cf522d76 | testnet | 2026-06-08T14:23:50.183Z | 2026-06-08T14:23:55.231Z | landed | 413986412 | confirmed | 1000 | 1 |
| dc197612b4eb89e24b995ba541cc175ea5e2cfd8b3233c89fc83563a1d2ba32f | testnet | 2026-06-08T14:24:28.382Z | 2026-06-08T14:24:33.430Z | landed | 413986508 | confirmed | 1000 | 1 |
| b1d5604bd0e09547c16e2a4d20fabb2f7b8c67861cb2c53ad8ac21cf00813454 | testnet | 2026-06-08T14:24:40.789Z | 2026-06-08T14:24:45.847Z | landed | 413986531 | confirmed | 1000 | 1 |
| 6ae3cdb9ad0bcc4cc028601567f0f85d76e4aadf39f343df692c1860a83d395a | testnet | 2026-06-08T14:24:48.983Z | 2026-06-08T14:24:54.048Z | landed | 413986564 | confirmed | 1000 | 1 |
| e6b2095281f617f4a9ae4426d63c6e9b1ed448e8c5c534d18437ff87c68b9704 | testnet | 2026-06-08T14:24:57.777Z | 2026-06-08T14:25:02.833Z | landed | 413986580 | confirmed | 1000 | 1 |
| 35b8a6ef1aee70d35f093f37217b5ab5bde3f3cab4b2dfde1fcd0bbeb39d229b | testnet | 2026-06-08T14:47:43.438Z | 2026-06-08T14:48:01.683Z | landed | 413990184 | confirmed | 1000 | 1 |
| b4b0eeb59ff884f86d9f6a1078ddee01bf1324264419148eee7d199de77e9694 | testnet | 2026-06-08T14:48:05.025Z | 2026-06-08T14:48:16.684Z | landed | 413990240 | confirmed | 1000 | 1 |
| 40ce0b8824103142ce6600b9e0c9d0caecc4b4913434518af1a6c14f0dced38d | testnet | 2026-06-08T14:48:20.118Z | 2026-06-08T14:48:25.167Z | landed | 413990260 | confirmed | 1000 | 1 |
| f3985ec7f3ef4dd3afe9c641881c00248c5b4ef9fdc91dbd4cbaeedb2d78e116 | testnet | 2026-06-08T14:48:28.542Z | 2026-06-08T14:48:33.604Z | landed | 413990272 | confirmed | 1000 | 1 |
| 1a484e0dbb7d0ff071851394959b8ed22ac99aaa8517ddf1d4a82f1c2a75625f | testnet | 2026-06-08T14:48:37.025Z | 2026-06-08T14:48:48.671Z | landed | 413990312 | confirmed | 1000 | 1 |
| d3b7dc52ec2ca5ae36f1a943f32c93b7f7cb793246110127789056d616d1c2a2 | testnet | 2026-06-08T14:48:52.319Z | 2026-06-08T14:49:11.354Z | landed | 413990376 | confirmed | 1000 | 1 |
| a9dddd41e2220936ce6dbab50a861f56ee41b1ed814f65b7b74543e0c5fa3fd1 | testnet | 2026-06-08T14:49:15.301Z | 2026-06-08T14:49:26.930Z | landed | 413990408 | confirmed | 1000 | 1 |
| 573e21e34031b66e265e094f2310de752141b4f39526876a637dc3a25053a63f | testnet | 2026-06-08T14:49:30.591Z | 2026-06-08T14:49:42.293Z | landed | 413990448 | confirmed | 1000 | 1 |
| b25ce34c4cd4abd326afbda2c37af32d878840db6408d64ef3ef7fa9623b04ce | testnet | 2026-06-08T14:49:45.565Z | 2026-06-08T14:49:50.641Z | landed | 413990484 | confirmed | 1000 | 1 |
| e1d12d421532d5012190ef1dfd3325d955cedf7239c6405f9f2f7615ae413ce3 | testnet | 2026-06-08T14:49:54.164Z | 2026-06-08T14:50:05.891Z | landed | 413990524 | confirmed | 1000 | 1 |
