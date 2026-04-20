import { nanoid } from "nanoid";

export const newId = (prefix = "id") => `${prefix}_${nanoid(10)}`;
