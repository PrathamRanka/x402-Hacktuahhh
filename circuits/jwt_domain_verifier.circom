pragma circom 2.1.6;

include "node_modules/circomlib/circuits/poseidon.circom";

/**
 * JWT Domain Verifier Circuit
 *
 * This circuit proves knowledge of a domain and wallet binding
 * without revealing the actual email address.
 *
 * Private Inputs:
 * - domain: Email domain encoded as 4 field elements (up to 124 chars)
 * - walletAddress: Wallet address as a single field element
 * - secret: Random secret for nullifier generation
 *
 * Public Outputs:
 * - domainHash: Poseidon hash of the domain
 * - nullifier: Unique identifier derived from domain + secret
 * - walletBinding: Hash binding wallet to domain
 */
template JWTDomainVerifier() {
    // Private inputs
    signal input domain[4];        // Domain encoded as 4 field elements
    signal input walletAddress;    // Wallet address as field element
    signal input secret;           // Secret for nullifier

    // Public outputs
    signal output domainHash;
    signal output nullifier;
    signal output walletBinding;

    // Hash the domain using Poseidon(4)
    component domainHasher = Poseidon(4);
    for (var i = 0; i < 4; i++) {
        domainHasher.inputs[i] <== domain[i];
    }
    domainHash <== domainHasher.out;

    // Generate nullifier = Poseidon(domainHash, secret)
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== domainHash;
    nullifierHasher.inputs[1] <== secret;
    nullifier <== nullifierHasher.out;

    // Create wallet binding = Poseidon(domainHash, walletAddress)
    component bindingHasher = Poseidon(2);
    bindingHasher.inputs[0] <== domainHash;
    bindingHasher.inputs[1] <== walletAddress;
    walletBinding <== bindingHasher.out;
}

component main = JWTDomainVerifier();
