/** The time source a service takes in its dependencies; tests pass a fake one. */
export type Clock = { now(): Date };
