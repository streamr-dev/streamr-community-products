require("dotenv/config")

const {
    Contract,
    getDefaultProvider,
    Wallet,
    utils: { parseUnits, formatEther, BigNumber },
    providers: { JsonRpcProvider }
} = require("ethers")

const StreamrClient = require("streamr-client")

const sleep = require("../src/utils/sleep-promise")
const { throwIfNotContract } = require("../src/utils/checkArguments")

const TokenContract = require("../build/ERC20Detailed.json")
const DataUnionContract = require("../build/DataunionVault.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    ETHEREUM_PRIVATE_KEY,

    DATAUNION_ADDRESS,
    GAS_PRICE_GWEI,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    SLEEP_MS,                   // set this to zero for automatic runs

    QUIET,
} = process.env

const log = QUIET ? () => {} : (...args) => {
    console.log(...args)
}
const error = (e, ...args) => {
    console.error(e.stack, ...args)
    process.exit(1)
}

// sleep before executing, let user double-check values
const sleepMs = Number.isNaN(+SLEEP_MS) ? 5000 : +SLEEP_MS

async function start() {
    // TODO: move process.env parsing logic to a separate file
    const provider =
        ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) :
        ETHEREUM_NETWORK ? getDefaultProvider(ETHEREUM_NETWORK) : null
    if (!provider) { throw new Error("Must supply either ETHEREUM_SERVER or ETHEREUM_NETWORK") }

    const network = await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    log("Connected to Ethereum network: ", JSON.stringify(network))

    const dataUnionAddress = await throwIfNotContract(provider, DATAUNION_ADDRESS, "env variable DATAUNION_ADDRESS")

    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    const wallet = new Wallet(privateKey, provider)

    log(`Checking DataunionVault contract at ${dataUnionAddress}...`)
    const dataUnion = new Contract(dataUnionAddress, DataUnionContract.abi, provider)
    const getters = DataUnionContract.abi.filter(f => f.constant && f.inputs.length === 0).map(f => f.name)
    for (const getter of getters) {
        log(`  ${getter}: ${await dataUnion[getter]()}`)
    }

    const _tokenAddress = await dataUnion.token()
    const tokenAddress = await throwIfNotContract(provider, _tokenAddress, `dataUnion(${dataUnionAddress}).token`)

    log(`Checking token contract at ${tokenAddress}...`)
    const token = new Contract(tokenAddress, TokenContract.abi, wallet)
    log("  Token name: ", await token.name())
    log("  Token symbol: ", await token.symbol())
    log("  Token decimals: ", await token.decimals())

    log("Connecting to Streamr...")
    const opts = { auth: { privateKey } }
    if (STREAMR_WS_URL) { opts.url = STREAMR_WS_URL }
    if (STREAMR_HTTP_URL) { opts.restUrl = STREAMR_HTTP_URL }
    const client = new StreamrClient(opts)

    log("Member stats:")
    const stats = await client.memberStats(dataUnionAddress, wallet.address)
    for (const [key, value] of Object.entries(stats)) {
        log(`  ${key}: ${value}`)
    }
    if (!stats.withdrawableBlockNumber) {
        throw new Error("No earnings to withdraw.")
    }

    const earningsBN = new BigNumber(stats.withdrawableEarnings)
    const withdrawnBN = await dataUnion.withdrawn(wallet.address)
    const unwithdrawnEarningsBN = earningsBN.sub(withdrawnBN)
    log(`  Previously withdrawn earnings: ${withdrawnBN.toString()}`)
    log(`  Previously unwithdrawn earnings: ${unwithdrawnEarningsBN.toString()}`)

    log(`Withdrawing ${formatEther(unwithdrawnEarningsBN)} DATA from ${dataUnionAddress} to ${wallet.address}...`)
    if (sleepMs) {
        log(`Sleeping ${sleepMs}ms, please check the values and hit Ctrl+C if you're in the least unsure`)
        await sleep(sleepMs)
    }

    // TODO: use client once withdraw is available from NPM
    //const tx = await client.getWithdrawTx(dataUnionAddress)
    const contract = new Contract(dataUnionAddress, DataUnionContract.abi, wallet)
    const options = {}
    if (GAS_PRICE_GWEI) { options.gasPrice = parseUnits(GAS_PRICE_GWEI, "gwei") }
    const tx = await contract.withdrawAll(
        stats.withdrawableBlockNumber,
        stats.withdrawableEarnings,
        stats.proof,
        options
    )

    log(`Follow transaction at https://etherscan.io/tx/${tx.hash}`)
    const tr = await tx.wait(1)
    log(`Receipt: ${JSON.stringify(tr)}`)
    log("[DONE]")
}

start().catch(error)
