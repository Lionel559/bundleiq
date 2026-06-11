async function main() {
  const { Keypair } = await import("@solana/web3.js");

  const wallet = Keypair.generate();

  console.log("PUBLIC KEY:");
  console.log(wallet.publicKey.toBase58());

  console.log("\nSECRET KEY:");
  console.log(JSON.stringify(Array.from(wallet.secretKey)));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
