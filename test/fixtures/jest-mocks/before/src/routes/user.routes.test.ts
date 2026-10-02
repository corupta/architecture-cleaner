import type { User } from "../models/user.model";
import { getUserRoute } from "./user.routes";

type UserRepository = { findUser(id: number): User | undefined };

jest.mock("../services/user.service", () => ({
  greetUser: (id: number) => `stub:${id}`,
}));
jest.unmock("@/services/user.repository");

describe("getUserRoute", () => {
  it("delegates to the mocked user service", () => {
    expect(getUserRoute(7)).toBe("stub:7");
  });

  it("reaches both repository variants", () => {
    jest.doMock("../services/user.repository");
    const actual = jest.requireActual<UserRepository>("../services/user.repository");
    const mocked = jest.requireMock<UserRepository>("@/services/user.repository");
    expect(actual.findUser(1)).toEqual({ id: 1, email: "ada@example.com" });
    expect(mocked.findUser(1)).toEqual({ id: 1, email: "mock@example.com" });
  });
});
