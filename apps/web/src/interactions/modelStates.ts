import { Object3D, Quaternion, Vector3 } from "three";

export type ModelState = {
  readonly isOpen: boolean;
  setOpen(open: boolean): void;
};

/** The supplied fridge has one hinged hierarchy, not two independently centered GLBs. */
export function createModelState(root: Object3D, productId: string): ModelState | undefined {
  if (productId !== "p-mini-fridge") return;
  let hinge: Object3D | undefined;
  root.traverse((node) => { if (/^DOOR[_ ]PIVOT/.test(node.name)) hinge = node; });
  if (!hinge) return; // failed/missing model must not advertise a working door
  const door = hinge;
  const closed = door.quaternion.clone();
  // Blender's +Z-up becomes glTF's +Y-up. The +110° pose matches the supplied render.
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 110 * Math.PI / 180);
  let isOpen = false;
  return {
    get isOpen() { return isOpen; },
    setOpen(open) {
      isOpen = open;
      door.quaternion.copy(closed);
      if (open) door.quaternion.multiply(turn);
      root.updateWorldMatrix(true, true);
    },
  };
}
