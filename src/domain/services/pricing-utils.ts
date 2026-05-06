export interface NilfiskProgramPricing {
  trueCost: number;
  edDataSellPrice: number;
  grossProfit: number;
  marginPercent: number;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeNilfiskSchoolHealthcarePricing(input: {
  dealerNet: number;
  listPrice: number;
}): NilfiskProgramPricing {
  const trueCost = input.dealerNet * 0.93;
  const edDataSellPrice = input.listPrice * 0.79;
  const grossProfit = edDataSellPrice - trueCost;
  const marginPercent = edDataSellPrice <= 0 ? 0 : grossProfit / edDataSellPrice;
  return {
    trueCost: round2(trueCost),
    edDataSellPrice: round2(edDataSellPrice),
    grossProfit: round2(grossProfit),
    marginPercent: Math.round(marginPercent * 10000) / 10000
  };
}
