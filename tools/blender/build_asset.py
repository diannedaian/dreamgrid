"""Trusted, offline FurnitureSpec -> Blender/GLB interpreter.

Inputs are data, never Python. Run only via Blender in a fresh background process.
The first slice supports boxes and cylinders; other schema primitives fail closed.
Runtime coordinates (x, y-up, z-forward) become Blender (x, -z, z-up).
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

AXES = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
MAX_TRIANGLES = 40000


def args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--glb", required=True, type=Path)
    parser.add_argument("--no-render", action="store_true")
    parser.add_argument("--fuse-material", help="Optional offline union of one material's parts")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def finite_vector(values):
    return isinstance(values, list) and len(values) == 3 and all(
        isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
        for v in values
    )


def validate_input(spec):
    """Defense in depth after canonical JSON Schema validation by the launcher."""
    if spec.get("schemaVersion") != "1.0":
        raise ValueError("Unsupported schema version")
    dims = spec["dimensionsM"]
    if not finite_vector(dims) or not all(0 < v <= 20 for v in dims):
        raise ValueError("Invalid physical dimensions")
    if not 1 <= len(spec["parts"]) <= 100 or not 1 <= len(spec["materials"]) <= 16:
        raise ValueError("Part/material budget exceeded")
    materials = {mat["id"] for mat in spec["materials"]}
    if len(materials) != len(spec["materials"]):
        raise ValueError("Duplicate material ID")
    ids = set()
    for part in spec["parts"]:
        if part["id"] in ids:
            raise ValueError("Duplicate part ID")
        ids.add(part["id"])
        if part["primitive"] not in {"box", "rounded-box", "cylinder"}:
            raise ValueError("This interpreter slice only supports boxes and cylinders")
        if part["materialId"] not in materials:
            raise ValueError("Unknown material")
        if not finite_vector(part["dimensionsM"]) or not all(
            0 < value <= 20 for value in part["dimensionsM"]
        ):
            raise ValueError("Invalid part dimensions")
        for key in ("positionM", "rotationDeg"):
            if not finite_vector(part[key]):
                raise ValueError(f"Invalid {key}")
        radius = part.get("cornerRadiusM", 0)
        if not math.isfinite(radius) or not 0 <= radius <= min(part["dimensionsM"]) / 2:
            raise ValueError("Bevel radius must fit inside the physical part")
        if "repeat" in part:
            repeat = part["repeat"]
            if not isinstance(repeat["count"], int) or not 2 <= repeat["count"] <= 16:
                raise ValueError("Invalid repeat count")
            if not finite_vector(repeat["offsetM"]):
                raise ValueError("Invalid repeat offset")


def linear_color(hex_color):
    rgb = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb)


def make_material(item):
    mat = bpy.data.materials.new(item["name"])
    mat.use_nodes = True
    color = (*linear_color(item["baseColorHex"]), 1)
    mat.diffuse_color = color
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = item["roughness"]
    bsdf.inputs["Metallic"].default_value = item["metallic"]
    return mat


def make_part(part, index, material, root, collection):
    width, height, depth = part["dimensionsM"]
    if part["primitive"] == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=1, depth=2)
    else:
        bpy.ops.mesh.primitive_cube_add(size=2)
    obj = bpy.context.object
    obj.name = part["id"] + (f"-{index:02d}" if "repeat" in part else "")
    obj.dimensions = (width, depth, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    radius = part.get("cornerRadiusM", 0)
    if radius > 0:
        bevel = obj.modifiers.new("Soft physical edges", "BEVEL")
        bevel.width = radius
        bevel.segments = 6 if part["role"] == "body" else 4
        bevel.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=bevel.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    normals = obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    normals.keep_sharp = True
    normals.weight = 50
    bpy.ops.object.modifier_apply(modifier=normals.name)
    pos = Vector(part["positionM"])
    if "repeat" in part:
        pos += index * Vector(part["repeat"]["offsetM"])
    obj.location = AXES @ pos
    runtime_rotation = Euler(tuple(math.radians(v) for v in part["rotationDeg"]), "XYZ")
    obj.rotation_euler = (AXES @ runtime_rotation.to_matrix() @ AXES.inverted()).to_euler()
    obj.data.materials.append(material)
    obj.parent = root
    obj["partRole"] = part["role"]
    for old_collection in list(obj.users_collection):
        old_collection.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def measure(objects):
    bpy.context.view_layer.update()
    points = [AXES.inverted() @ (obj.matrix_world @ v.co) for obj in objects for v in obj.data.vertices]
    lower = [min(p[i] for p in points) for i in range(3)]
    upper = [max(p[i] for p in points) for i in range(3)]
    for obj in objects:
        obj.data.calc_loop_triangles()
    return {
        "minM": lower,
        "maxM": upper,
        "dimensionsM": [upper[i] - lower[i] for i in range(3)],
        "meshCount": len(objects),
        "triangles": sum(len(obj.data.loop_triangles) for obj in objects),
    }


def assert_normalized(report, dimensions):
    expected_min = [-dimensions[0] / 2, 0, -dimensions[2] / 2]
    expected_max = [dimensions[0] / 2, dimensions[1], dimensions[2] / 2]
    for key, expected in (("minM", expected_min), ("maxM", expected_max)):
        if any(abs(actual - wanted) > 0.00001 for actual, wanted in zip(report[key], expected)):
            raise ValueError(f"Physical bounding box mismatch: {report}")
    if report["triangles"] > MAX_TRIANGLES:
        raise ValueError(f"Triangle budget exceeded: {report['triangles']} > {MAX_TRIANGLES}")


def fuse_material(objects, material):
    """Soften touching primitive joints without changing the declared envelope.

    This is a fixed local mesh operation, not instructions evaluated from a spec.
    It is opt-in so the original bed and desk geometry remain unchanged.
    """
    selected = [obj for obj in objects if obj.data.materials[0] == material]
    remaining = [obj for obj in objects if obj not in selected]
    if len(selected) < 2:
        raise ValueError("Material fusion requires at least two mesh parts")
    before = measure(selected)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]
    bpy.ops.object.join()
    fused = bpy.context.object
    fused.name = "Continuous_" + material.name.replace(" ", "_")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    remesh = fused.modifiers.new("Union overlapping wood joints", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = .0016
    remesh.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth = fused.modifiers.new("Soften joined corners", "SMOOTH")
    smooth.factor = .75
    smooth.iterations = 16
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    fused.data.calc_loop_triangles()
    decimate = fused.modifiers.new("Web mesh budget", "DECIMATE")
    decimate.ratio = min(1.0, 18000 / len(fused.data.loop_triangles))
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    after = measure([fused])
    for vertex in fused.data.vertices:
        point = AXES.inverted() @ vertex.co
        for axis in range(3):
            normalized = (point[axis] - after["minM"][axis]) / after["dimensionsM"][axis]
            point[axis] = before["minM"][axis] + normalized * before["dimensionsM"][axis]
        vertex.co = AXES @ point
    # Normal smoothing removes voxel facets while preserving the physical silhouette.
    for polygon in fused.data.polygons:
        polygon.use_smooth = True
    fused.data.update()
    return [*remaining, fused]


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def studio(scene, dimensions):
    """Preview-only stage. Added after GLB export, never part of furniture."""
    stage = bpy.data.collections.new("STUDIO — not exported")
    scene.collection.children.link(stage)

    def move_to_stage(obj):
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        stage.objects.link(obj)

    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.001))
    ground = bpy.context.object
    ground.name = "Preview ground — not a model part"
    ground.data.materials.append(make_material({
        "name": "Warm porcelain backdrop", "baseColorHex": "#EEE3D5", "roughness": .82,
        "metallic": 0,
    }))
    move_to_stage(ground)
    for name, location, power, size, color in [
        ("Large softbox", (1.4, -2.2, 4), 420, 4.0, (1, .88, .75)),
        ("Lavender fill", (-3, -.2, 2.2), 140, 3.0, (.77, .82, 1)),
        ("Warm rim", (1.2, 3, 3.6), 320, 3.0, (1, .93, .83)),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.shape, data.size, data.color = power, "DISK", size, color
        obj = bpy.data.objects.new(name, data)
        stage.objects.link(obj)
        obj.location = location
        point_at(obj, (0, 0, .4))
    camera_data = bpy.data.cameras.new("Product preview")
    camera = bpy.data.objects.new("Product preview", camera_data)
    stage.objects.link(camera)
    target_height = dimensions[1] * .47
    camera.location = (3.6, -4.5, target_height + 2.66)
    point_at(camera, (0, 0, target_height))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(dimensions) * 1.64
    camera_data.lens = 50
    scene.camera = camera
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.78, .84, 1, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .35
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = .35
    return camera


def main():
    options = args()
    asset_name = options.spec.stem
    spec = json.loads(options.spec.read_text())
    validate_input(spec)
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    glb = options.glb.resolve()
    glb.parent.mkdir(parents=True, exist_ok=True)
    # This is a fresh --factory-startup background process, not the user's GUI scene.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    collection = bpy.data.collections.new("ASSET — " + asset_name)
    scene.collection.children.link(collection)
    root = bpy.data.objects.new("DreamGrid_" + asset_name.replace("-", "_"), None)
    collection.objects.link(root)
    root["dimensionsM"] = spec["dimensionsM"]
    root["pivot"] = "bottom-center"
    root["forwardAxis"] = "+Z (glTF); -Y (Blender)"
    root["disclosure"] = "Codex-authored declarative model interpreted in Blender; not a live API result."
    materials = {item["id"]: make_material(item) for item in spec["materials"]}
    objects = [
        make_part(part, index, materials[part["materialId"]], root, collection)
        for part in spec["parts"]
        for index in range(part.get("repeat", {}).get("count", 1))
    ]
    if options.fuse_material:
        if options.fuse_material not in materials:
            raise ValueError("Unknown material requested for fusion")
        objects = fuse_material(objects, materials[options.fuse_material])
    report = measure(objects)
    assert_normalized(report, spec["dimensionsM"])
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [root, *objects]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb), export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_extras=True,
        export_cameras=False, export_lights=False,
    )
    report["glbBytes"] = glb.stat().st_size
    if report["glbBytes"] > 2_000_000:
        raise ValueError("GLB exceeds the 2 MB asset budget")
    report["spec"] = str(options.spec)
    report["blenderVersion"] = bpy.app.version_string
    report["dimensionToleranceM"] = .00001
    (output / "validation.json").write_text(json.dumps(report, indent=2) + "\n")
    camera = studio(scene, spec["dimensionsM"])
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    # Open the saved .blend directly on the composition with material colors.
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.region_3d.view_perspective = "CAMERA"
                area.spaces.active.shading.type = "MATERIAL"
                area.spaces.active.overlay.show_overlays = False
    scene.render.filepath = str(output / f"{asset_name}-preview.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(output / f"{asset_name}.blend"))
    if not options.no_render:
        bpy.ops.render.render(write_still=True)
        camera.location = (3.5, -4.5, 5.2)
        point_at(camera, (0, 0, spec["dimensionsM"][1] * .41))
        scene.render.filepath = str(output / f"{asset_name}-top-preview.png")
        bpy.ops.render.render(write_still=True)
    print("DREAMGRID_VALIDATION " + json.dumps(report))


if __name__ == "__main__":
    main()
