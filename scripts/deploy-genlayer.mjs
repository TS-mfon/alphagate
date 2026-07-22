import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

function requireValue(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function deploymentAddress(receipt) {
  return receipt?.data?.contract_address
    ?? receipt?.data?.contractAddress
    ?? receipt?.txDataDecoded?.contract_address
    ?? receipt?.txDataDecoded?.contractAddress;
}

const privateKey = requireValue("GENLAYER_PRIVATE_KEY");
const treasury = requireValue("X402_PAY_TO");
const account = createAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
const client = createClient({ chain: studionet, account });
const code = await readFile(path.resolve("contracts/genlayer/AlphaGateConsensus.py"), "utf8");

console.log(`Deploying AlphaGateConsensus from ${account.address} to GenLayer Studionet`);
const hash = await client.deployContract({
  account,
  code,
  args: [account.address, treasury]
});
const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.FINALIZED,
  interval: 3000,
  retries: 120,
  fullTransaction: true
});
const address = deploymentAddress(receipt);
if (!address) {
  throw new Error(`Deployment receipt did not include a contract address: ${JSON.stringify(receipt).slice(0, 800)}`);
}

console.log(JSON.stringify({
  hash,
  address,
  operator: account.address,
  treasury,
  network: "studionet"
}, null, 2));
