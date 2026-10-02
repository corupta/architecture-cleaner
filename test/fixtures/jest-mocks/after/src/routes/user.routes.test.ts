import type { User } from "../models/user.model";
import { getUserRoute } from "./user.routes";

type UserRepository = { findUser(id: number): User | undefined };

jest.mock("../modules/user/user.service", () => ({
  greetUser: (id: number) => `stub:${id}`,
}));
jest.unmock("@/modules/user/user.repository");

describe("getUserRoute", () => {
  it("delegates to the mocked user service", () => {
    expect(getUserRoute(7)).toBe("stub:7");
  });

  it("reaches both repository variants", () => {
    jest.doMock("../modules/user/user.repository");
    const actual = jest.requireActual<UserRepository>("../modules/user/user.repository");
    const mocked = jest.requireMock<UserRepository>("@/modules/user/user.repository");
    expect(actual.findUser(1)).toEqual({ id: 1, email: "ada@example.com" });
    expect(mocked.findUser(1)).toEqual({ id: 1, email: "mock@example.com" });
  });
});
