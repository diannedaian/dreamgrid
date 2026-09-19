import type { Product, RoomState } from "@dreamgrid/contracts";

import productsJson from "../../../../fixtures/products.json";
import roomStateJson from "../../../../fixtures/room-state.json";

/**
 * Shared fixtures for the standalone commerce demo. The casts narrow JSON's
 * wide literal types (e.g. rotationYDeg: number) to the contract types; the
 * contracts package validates these same files in its tests.
 */
export const demoProducts = productsJson as Product[];
export const demoRoomState = roomStateJson as RoomState;
