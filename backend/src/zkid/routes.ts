import { Router, Request, Response } from "express";
import { createHash } from "crypto";
import { getDb } from "../db";

const router = Router();

// POST /proofs - Store a ZKID proof
router.post("/proofs", async (req: Request, res: Response) => {
  const { walletAddress, domain, method, generatedAt, proof, publicSignals } = req.body;

  // Validate required fields
  if (
    !walletAddress ||
    !domain ||
    !method ||
    typeof generatedAt !== "number" ||
    !proof ||
    !Array.isArray(publicSignals)
  ) {
    return res.status(400).json({ error: "INVALID_PROOF_BODY" });
  }

  // Compute proofHash as SHA-256 of JSON.stringify(req.body)
  const proofHash = createHash("sha256")
    .update(JSON.stringify(req.body))
    .digest("hex");

  // Create document
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const doc = {
    walletAddress,
    domain,
    method,
    proof,
    publicSignals,
    generatedAt,
    proofHash,
    createdAt: new Date(),
    expiresAt,
  };

  try {
    const db = await getDb();
    const collection = db.collection("zkid_proofs");

    // Upsert using updateOne with $setOnInsert
    await collection.updateOne(
      { proofHash },
      { $setOnInsert: doc },
      { upsert: true }
    );

    return res.json({
      ok: true,
      proofHash,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Error storing proof:", error);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

// GET /proofs/latest - Get the most recent proof for a wallet
router.get("/proofs/latest", async (req: Request, res: Response) => {
  const { walletAddress } = req.query;

  if (!walletAddress || typeof walletAddress !== "string") {
    return res.status(400).json({ error: "MISSING_WALLET_ADDRESS" });
  }

  try {
    const db = await getDb();
    const collection = db.collection("zkid_proofs");

    // Find the most recent proof sorted by generatedAt descending
    const proofs = await collection
      .find({ walletAddress })
      .sort({ generatedAt: -1 })
      .limit(1)
      .toArray();
    
    const proof = proofs[0];

    if (!proof) {
      return res.status(404).json({ error: "PROOF_NOT_FOUND" });
    }

    // Remove _id from the response
    const { _id, ...proofWithoutId } = proof;

    return res.json(proofWithoutId);
  } catch (error) {
    console.error("Error retrieving proof:", error);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

export default router;

