import { refundCharge } from "./refund.service";

vi.mock("@/services/payment.gateway");
vi.mock("./tax.calculator");

describe("refundCharge", () => {
  it("asks the mocked gateway to refund the charge", async () => {
    const gateway = await vi.importMock<typeof import("@/services/payment.gateway")>("@/services/payment.gateway");
    await refundCharge({ id: "charge-1", amount: 120 });
    expect(gateway.refund).toHaveBeenCalledWith("charge-1");
  });
});
