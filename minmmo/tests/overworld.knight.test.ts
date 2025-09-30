import { beforeAll, describe, expect, it, vi } from "vitest";

describe("Overworld knight idle frame selection", () => {
  let Overworld: typeof import("@game/scenes/Overworld").Overworld;

  beforeAll(async () => {
    vi.doMock("phaser", () => {
      class Vector2 {
        x: number;
        y: number;
        constructor(x = 0, y = 0) {
          this.x = x;
          this.y = y;
        }
      }

      class Scene {
        public anims = { exists: vi.fn(), create: vi.fn(), generateFrameNumbers: vi.fn() };
        public add = {} as Record<string, unknown>;
        public matter = {} as Record<string, unknown>;
        public events = { once: vi.fn(), on: vi.fn(), off: vi.fn() };
        public scale = { on: vi.fn(), off: vi.fn() };
        public cameras = { main: {} } as Record<string, unknown>;
        public input = { keyboard: { addKeys: vi.fn(), addKey: vi.fn(), addCapture: vi.fn(), removeCapture: vi.fn() } };
        constructor() {}
      }

      return {
        default: {
          Scene,
          Math: {
            Vector2,
            Clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max),
          },
          Geom: { Polygon: class {} },
          Input: {
            Keyboard: {
              KeyCodes: { W: 87, A: 65, S: 83, D: 68, ESC: 27 },
              JustDown: () => false,
            },
          },
          Physics: { Matter: { Sprite: class {}, Events: { CollisionStartEvent: class {} } } },
          Tilemaps: { Tilemap: class {}, Tileset: class {}, TilemapLayer: class {} },
          Cameras: { Scene2D: { Camera: class {} } },
          GameObjects: { Rectangle: class {}, Arc: class {}, GameObject: class {} },
          Scenes: { Events: { SHUTDOWN: "shutdown", DESTROY: "destroy" } },
          Scale: { Events: { RESIZE: "resize" } },
          Structs: { Size: class {} },
          Types: { Tilemaps: { TiledObject: class {} }, Math: { Vector2Like: class {} } },
        },
      };
    }, { virtual: true });
    vi.doMock("phaser3spectorjs", () => ({}), { virtual: true });
    const fakeContext = {
      fillStyle: "",
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
      putImageData: vi.fn(),
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => fakeContext as unknown as CanvasRenderingContext2D);
    ({ Overworld } = await import("@game/scenes/Overworld"));
  });

  const directions = [
    { facing: "north" as const, expectedTexture: "knight-walk-north" },
    { facing: "south" as const, expectedTexture: "knight-walk-south" },
    { facing: "east" as const, expectedTexture: "knight-walk-east" },
    { facing: "west" as const, expectedTexture: "knight-walk-west" },
  ];

  for (const { facing, expectedTexture } of directions) {
    it(`uses the ${facing} walk sheet when stopping`, () => {
      const scene = new Overworld();
      const stop = vi.fn();
      const setTexture = vi.fn();
      (scene as any).playerFacing = facing;
      (scene as any).player = {
        anims: { stop },
        setTexture,
      };

      (scene as any).setKnightIdleFrame();

      expect(stop).toHaveBeenCalledOnce();
      expect(setTexture).toHaveBeenCalledWith(expectedTexture, 0);
    });
  }
});
