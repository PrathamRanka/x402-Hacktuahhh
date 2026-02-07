const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const BUILD_DIR = path.join(__dirname, 'build')
const CIRCUIT_NAME = 'jwt_domain_verifier'
const FRONTEND_ZK_DIR = path.join(__dirname, '..', 'frontend', 'public', 'zk')

async function build() {
  console.log('Building ZK circuit...\n')

  // Check if circom is installed
  try {
    execSync('which circom', { stdio: 'pipe' })
  } catch {
    console.error('Error: circom is not installed.')
    console.error('Install with: brew install circom (macOS)')
    console.error('Or visit: https://docs.circom.io/getting-started/installation/')
    process.exit(1)
  }

  // Create build directory
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true })
  }

  // Step 1: Compile the circuit
  console.log('1. Compiling circuit...')
  try {
    execSync(
      `circom ${CIRCUIT_NAME}.circom --r1cs --wasm --sym -o build`,
      { cwd: __dirname, stdio: 'inherit' }
    )
  } catch (error) {
    console.error('Failed to compile circuit')
    process.exit(1)
  }

  // Step 2: Download Powers of Tau
  const ptauPath = path.join(BUILD_DIR, 'pot12_final.ptau')
  if (!fs.existsSync(ptauPath)) {
    console.log('\n2. Downloading Powers of Tau ceremony file...')
    execSync(
      `curl -L -o "${ptauPath}" https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau`,
      { stdio: 'inherit' }
    )
  } else {
    console.log('\n2. Powers of Tau file already exists, skipping download...')
  }

  // Step 3: Generate zkey using snarkjs
  console.log('\n3. Generating proving key (zkey)...')
  const snarkjs = require('snarkjs')

  const r1csPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}.r1cs`)
  const zkey0Path = path.join(BUILD_DIR, `${CIRCUIT_NAME}_0.zkey`)
  const zkeyPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}.zkey`)

  await snarkjs.zKey.newZKey(r1csPath, ptauPath, zkey0Path)

  // Contribute to the ceremony
  console.log('\n4. Contributing to ceremony...')
  await snarkjs.zKey.contribute(
    zkey0Path,
    zkeyPath,
    'x402-zkid',
    'random-entropy-' + Date.now()
  )

  // Clean up intermediate file
  fs.unlinkSync(zkey0Path)

  // Step 4: Export verification key
  console.log('\n5. Exporting verification key...')
  const vkeyPath = path.join(BUILD_DIR, 'verification_key.json')
  const vkey = await snarkjs.zKey.exportVerificationKey(zkeyPath)
  fs.writeFileSync(vkeyPath, JSON.stringify(vkey, null, 2))

  // Step 5: Copy artifacts to frontend
  console.log('\n6. Copying artifacts to frontend/public/zk...')
  if (!fs.existsSync(FRONTEND_ZK_DIR)) {
    fs.mkdirSync(FRONTEND_ZK_DIR, { recursive: true })
  }

  // Copy wasm
  const wasmSrc = path.join(BUILD_DIR, `${CIRCUIT_NAME}_js`, `${CIRCUIT_NAME}.wasm`)
  fs.copyFileSync(wasmSrc, path.join(FRONTEND_ZK_DIR, `${CIRCUIT_NAME}.wasm`))

  // Copy zkey
  fs.copyFileSync(zkeyPath, path.join(FRONTEND_ZK_DIR, `${CIRCUIT_NAME}.zkey`))

  // Copy verification key
  fs.copyFileSync(vkeyPath, path.join(FRONTEND_ZK_DIR, 'verification_key.json'))

  console.log('\n✅ Build complete!')
  console.log(`   WASM:  ${path.join(FRONTEND_ZK_DIR, `${CIRCUIT_NAME}.wasm`)}`)
  console.log(`   ZKey:  ${path.join(FRONTEND_ZK_DIR, `${CIRCUIT_NAME}.zkey`)}`)
  console.log(`   VKey:  ${path.join(FRONTEND_ZK_DIR, 'verification_key.json')}`)
  console.log('\n   The frontend will automatically use real proofs when these files exist.')
}

build().catch(err => {
  console.error('Build failed:', err)
  process.exit(1)
})
