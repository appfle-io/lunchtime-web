import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function testZeroPayPureFetch(name: string, district: string = "영등포구") {
  console.log(`=== Testing Pure HTTP fetch for zeropay.or.kr (query: ${name}, gu: ${district}) ===`);

  try {
    const url = "https://www.zeropay.or.kr/UI_HP_009_03.act";

    // zeropay.or.kr comAjax payload
    const bodyParams = new URLSearchParams({
      AFLT_ADDR_CITY: "서울특별시",
      AFLT_ADDR_CITY_SIMPLE: "서울",
      AFLT_ADDR_GU: district,
      AFLT_NM: name,
      AFLT_ROAD_ADDR: "",
      BIZ_TYPE_CD: "",
      TRX_TP: "01",
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.zeropay.or.kr/UI_HP_009_03.act",
      },
      body: bodyParams.toString(),
    });

    console.log("Response Status:", res.status);
    const json = await res.json().catch(() => null);
    console.log("Returned LIST2 Count:", json?.LIST2?.length ?? 0);
    if (json?.LIST2 && json.LIST2.length > 0) {
      console.log("Sample Match:", json.LIST2[0]);
    }
  } catch (err) {
    console.error("Error fetching ZeroPay:", err);
  }
}

testZeroPayPureFetch("아바이순대국");
