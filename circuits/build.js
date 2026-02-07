const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const snarkjs = require('snarkjs');

// -----------------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------------
const CIRCUIT_NAME = 'jwt_domain_verifier';
const ROOT_DIR = __dirname;
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const FRONTEND_ZK_DIR = path.join(ROOT_DIR, '..', 'frontend', 'public', 'zk');

// Cross-platform circom binary
const CIRCOM_BIN =
  process.platform === 'win32'
    ? 'C:\\circom\\circom.exe'
    : 'circom';

// Powers of Tau file
const PTAU_URL =
  'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau';
const PTAU_PATH = path.join(BUILD_DIR, 'pot12_final.ptau');

// -----------------------------------------------------------------------------
// BUILD
// -----------------------------------------------------------------------------
async function build() {
  console.log('Building ZK circuit...\n');

  // ---------------------------------------------------------------------------
  // 0. Verify circom exists
  // ---------------------------------------------------------------------------
  try {
    execSync(`"${CIRCOM_BIN}" --version`, { stdio: 'pipe' });
  } catch {
    console.error('❌ circom not found.');
    console.error('Expected binary at:', CIRCOM_BIN);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 1. Prepare directories
  // ---------------------------------------------------------------------------
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }

  if (!fs.existsSync(FRONTEND_ZK_DIR)) {
    fs.mkdirSync(FRONTEND_ZK_DIR, { recursive: true });
  }

  // ---------------------------------------------------------------------------
  // 2. Compile circuit
  // ---------------------------------------------------------------------------
  console.log('1. Compiling circuit...');
  execSync(
    `"${CIRCOM_BIN}" ${CIRCUIT_NAME}.circom --r1cs --wasm --sym -o build`,
    { cwd: ROOT_DIR, stdio: 'inherit' }
  );

  // ---------------------------------------------------------------------------
  // 3. Download Powers of Tau (if missing)
  // ---------------------------------------------------------------------------
  if (!fs.existsSync(PTAU_PATH)) {
    console.log('\n2. Downloading Powers of Tau...');
    execSync(`curl -L "${PTAU_URL}" -o "${PTAU_PATH}"`, {
      stdio: 'inherit',
    });
  } else {
    console.log('\n2. Powers of Tau already exists, skipping...');
  }

  // ---------------------------------------------------------------------------
  // 4. Generate zkey
  // ---------------------------------------------------------------------------
  console.log('\n3. Generating zkey...');
  const r1csPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}.r1cs`);
  const zkey0Path = path.join(BUILD_DIR, `${CIRCUIT_NAME}_0.zkey`);
  const zkeyPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}.zkey`);

  await snarkjs.zKey.newZKey(r1csPath, PTAU_PATH, zkey0Path);

  console.log('\n4. Contributing to ceremony...');
  await snarkjs.zKey.contribute(
    zkey0Path,
    zkeyPath,
    'x402-zkid',
    'random-entropy-' + Date.now()
  );

  fs.unlinkSync(zkey0Path);

  // ---------------------------------------------------------------------------
  // 5. Export verification key
  // ---------------------------------------------------------------------------
  console.log('\n5. Exporting verification key...');
  const vkey = await snarkjs.zKey.exportVerificationKey(zkeyPath);
  const vkeyPath = path.join(BUILD_DIR, 'verification_key.json');
  fs.writeFileSync(vkeyPath, JSON.stringify(vkey, null, 2));

  // ---------------------------------------------------------------------------
  // 6. Copy artifacts to frontend
  // ---------------------------------------------------------------------------
  console.log('\n6. Copying artifacts to frontend/public/zk...');

  const wasmSrc = path.join(
    BUILD_DIR,
    `${CIRCUIT_NAME}_js`,
    `${CIRCUIT_NAME}.wasm`
  );

  fs.copyFileSync(
    wasmSrc,
    path.join(FRONTEND_ZK_DIR, `${CIRCUIT_NAME}.wasm`)
  );
  fs.copyFileSync(
    zkeyPath,
    path.join(FRONTEND_ZK_DIR, `${CIRCUIT_NAME}.zkey`)
  );
  fs.copyFileSync(
    vkeyPath,
    path.join(FRONTEND_ZK_DIR, 'verification_key.json')
  );

  // ---------------------------------------------------------------------------
  // DONE
  // ---------------------------------------------------------------------------
  console.log('\n✅ BUILD COMPLETE');
  console.log('Artifacts:');
  console.log('  WASM:', path.join(FRONTEND_ZK_DIR, `${CIRCUIT_NAME}.wasm`));
  console.log('  ZKEY:', path.join(FRONTEND_ZK_DIR, `${CIRCUIT_NAME}.zkey`));
  console.log(
    '  VKEY:',
    path.join(FRONTEND_ZK_DIR, 'verification_key.json')
  );
  console.log('\nFrontend will now use REAL ZK proofs.');
}

build().catch(err => {
  console.error('\n❌ Build failed:', err);
  process.exit(1);
});
