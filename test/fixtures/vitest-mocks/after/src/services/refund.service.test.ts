import { refundCharge } from "./refund.service";

vi.mock("@/platform/payment.gateway");
vi.mock("./tax.calculator");

describe("refundCharge", () => {
  it("asks the mocked gateway to refund the charge", async () => {
    const gateway = await vi.importMock<typeof import("@/platform/payment.gateway")>("@/platform/payment.gateway");
    await refundCharge({ id: "charge-1", amount: 120 });
    expect(gateway.refund).toHaveBeenCalledWith("charge-1");
  });
});
