import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function inspectPulmuone() {
  const { db } = await import("../src/lib/firebase");

  console.log("=== Searching specifically for Pulmuone / Cafeteria in Firestore ===");

  const companiesSnap = await db.collection("companies").get();
  for (const companyDoc of companiesSnap.docs) {
    const companyCode = companyDoc.id;
    const snapshot = await db.collection("companies").doc(companyCode).collection("restaurants").get();

    const results: any[] = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const allText = JSON.stringify(data);
      if (
        allText.includes("풀무원") ||
        allText.includes("푸드앤컬처") ||
        allText.includes("직원식당") ||
        allText.includes("구내식당")
      ) {
        results.push({
          id: doc.id,
          name: data.name,
          displayName: data.displayName,
          naverMatchedName: data.naverMatchedName,
          zeroPayOfficialName: data.zeroPayOfficialName,
          businessName: data.businessName,
          address: data.address,
          category: data.category,
          categoryLabel: data.categoryLabel,
          isActive: data.isActive,
          isZeroPay: data.isZeroPay,
        });
      }
    });

    console.log(`Found ${results.length} Pulmuone / Cafeteria related records in '${companyCode}':`);
    console.log(JSON.stringify(results, null, 2));
  }
}

inspectPulmuone().catch(console.error);
