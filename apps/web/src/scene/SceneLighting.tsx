/** Renderer defaults; Dianne can replace these with room-specific lights. */
export function SceneLighting() {
  return (
    <>
      <ambientLight intensity={1.6} />
      <directionalLight position={[4, 6, 4]} intensity={2.4} />
    </>
  );
}
