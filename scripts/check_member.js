require("dotenv/config")

const {
    Contract,
    getDefaultProvider,
    providers: { JsonRpcProvider },
    utils: { BigNumber },
    Wallet,
} = require("ethers")

const StreamrClient = require("streamr-client")

const { throwIfNotContract, throwIfBadAddress } = require("../src/utils/checkArguments")

const CommunityJson = require("../build/CommunityProduct.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers

    ETHEREUM_PRIVATE_KEY,       // either derive the address from key...
    MEMBER_ADDRESS,             // ...or get it directly

    COMMUNITY_ADDRESS,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    QUIET,
} = process.env

const log = QUIET ? () => {} : (...args) => {
    console.log(...args)
}
const error = (e, ...args) => {
    console.error(e.stack, ...args)
    process.exit(1)
}

async function start() {
    const provider = ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) : getDefaultProvider(ETHEREUM_NETWORK)
    const network = await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    log("Connected to Ethereum network: ", JSON.stringify(network))

    let wallet
    if (ETHEREUM_PRIVATE_KEY) {
        const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
        if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
        wallet = new Wallet(privateKey, provider)
    }

    const communityAddress = await throwIfNotContract(provider, COMMUNITY_ADDRESS, "env variable COMMUNITY_ADDRESS")
    const memberAddress = wallet && wallet.address || await throwIfBadAddress(MEMBER_ADDRESS, "env variable MEMBER_ADDRESS")

    log(`Checking community contract at ${communityAddress}...`)
    const community = new Contract(communityAddress, CommunityJson.abi, provider)

    log("Connecting to Streamr...")
    const opts = {}
    if (STREAMR_WS_URL) { opts.url = STREAMR_WS_URL }
    if (STREAMR_HTTP_URL) { opts.restUrl = STREAMR_HTTP_URL }
    const client = new StreamrClient(opts)

    log(`Member stats for ${memberAddress}...`)
    const stats = await client.memberStats(communityAddress, memberAddress)
    if (stats.error) {
        log(`Error from server: ${JSON.stringify(stats)}`)
        return
    }
    for (const [key, value] of Object.entries(stats)) {
        log(`  Server: ${key}: ${value}`)
    }

    const withdrawnBN = await community.withdrawn(memberAddress)
    log(`  Contract: Proven earnings: ${(await community.earnings(memberAddress)).toString()}`)
    log(`  Contract: Withdrawn earnings: ${withdrawnBN.toString()}`)

    // check withdraw proof
    if (!stats.withdrawableBlockNumber) {
        log("  No earnings to withdraw.")
        return
    }

    // function proofIsCorrect(uint blockNumber, address account, uint balance, bytes32[] memory proof) public view returns(bool)
    const proofIsCorrect = await community.proofIsCorrect(
        stats.withdrawableBlockNumber,
        memberAddress,
        stats.withdrawableEarnings,
        stats.proof,
    )
    if (!proofIsCorrect) {
        log("  !!! INCORRECT PROOF !!!")
        return
    }
    log("  Proof checked and valid")

    const earningsBN = new BigNumber(stats.withdrawableEarnings)
    const unwithdrawnEarningsBN = earningsBN.sub(withdrawnBN)
    log(`  The withdrawAll tx would transfer ${unwithdrawnEarningsBN.toString()} DATA to ${memberAddress}`)
}

start().catch(error)
