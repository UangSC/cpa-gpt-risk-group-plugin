"""把原生构建产物打包为 CPA 商店使用的 GitHub Release 资产。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from shutil import copyfileobj
from struct import unpack_from
import subprocess
from tempfile import TemporaryDirectory
from typing import NamedTuple
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = {"linux": ".so", "windows": ".dll"}
TARGETS = {
    ("linux", "amd64"): 62,  # EM_X86_64
    ("linux", "arm64"): 183,  # EM_AARCH64
    ("windows", "amd64"): 0x8664,  # IMAGE_FILE_MACHINE_AMD64
}
NOTICES = ("THIRD_PARTY_NOTICES.md", "internal/fingerprint/PORT_LICENSE", "internal/fingerprint/data/LICENSE")


class ReleaseSource(NamedTuple):
    tag: str
    revision: str
    module: str
    go_exe: str


def release_identity(tag):
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    registry = json.loads((ROOT / "store/registry.json").read_text(encoding="utf-8"))
    plugin_id, version = package["name"], package["version"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", plugin_id):
        raise ValueError("插件 ID 不符合 CLIProxyAPI 插件商店命名规范")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or (tag is not None and tag != "v" + version):
        raise ValueError("发布标签须与 package.json 中的三段版本一致")
    if registry.get("schema_version") != 1:
        raise ValueError("商店清单 schema_version 必须为 1")
    plugins = registry.get("plugins") or []
    if len(plugins) != 1 or plugins[0].get("id") != plugin_id:
        raise ValueError("商店插件 ID 与包名不一致")
    if plugins[0].get("version") and plugins[0].get("version") != version:
        raise ValueError("store/registry.json 的 version 与 package.json 不一致")
    repository = plugins[0].get("repository", "")
    if not re.fullmatch(r"https://github\.com/[^/]+/[^/]+", repository):
        raise ValueError("商店仓库地址必须为 https://github.com/{owner}/{repo}")
    pkg_repo = re.sub(r"^git\+|\.git$", "", (package.get("repository") or {}).get("url", ""))
    if pkg_repo != repository:
        raise ValueError("package.json 与 store/registry.json 的仓库地址不一致")
    source = (ROOT / "cmd/downshift/plugin.go").read_text(encoding="utf-8")
    for key, expected in (("pluginID", plugin_id), ("version", version)):
        if not re.search(rf'^const {key} = "{re.escape(expected)}"$', source, re.M):
            raise ValueError(f"插件注册的 {key} 与发布配置不一致")
    if f'"GitHubRepository": "{repository}"' not in source:
        raise ValueError("插件注册的 GitHubRepository 与 store/registry.json 不一致")
    if not (ROOT / "assets/logo.svg").is_file():
        raise ValueError("缺少插件 Logo 文件 assets/logo.svg")
    logo = plugins[0].get("logo", "")
    if logo and f'"Logo": "{logo}"' not in source:
        raise ValueError("插件注册的 Logo 与 store/registry.json 不一致")
    service_src = (ROOT / "internal/classifier/service.go").read_text(encoding="utf-8")
    expected_prefix = f"/v0/management/plugins/{plugin_id}"
    if not re.search(rf'^const apiPrefix = "{re.escape(expected_prefix)}"$', service_src, re.M):
        raise ValueError("internal/classifier/service.go 的 apiPrefix 与插件 ID 不一致")
    contract_src = (ROOT / "src/api/contract.ts").read_text(encoding="utf-8")
    if not re.search(rf"^export const PLUGIN_ID = '{re.escape(plugin_id)}'$", contract_src, re.M):
        raise ValueError("src/api/contract.ts 的 PLUGIN_ID 与插件 ID 不一致")
    return plugin_id, version


def release_source(tag, go_exe):
    if tag is None:
        return None
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise ValueError("发布标签必须使用 v 加三段版本")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    tagged = subprocess.run(
        ["git", "rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if tagged.returncode or tagged.stdout.strip() != head:
        raise ValueError(f"当前提交必须对应 Git 标签 {tag}，否则 Go 会记录不同的构建版本")
    module = re.search(r"^module\s+(\S+)", (ROOT / "go.mod").read_text(encoding="utf-8"), re.M)
    if not module:
        raise ValueError("无法识别 go.mod 中的模块路径")
    return ReleaseSource(tag, head, module[1], go_exe)


def archive_name(plugin_id, version, platform, arch):
    return f"{plugin_id}_{version}_{platform}_{arch}.zip"


def verify_library(library, platform, arch):
    machine = TARGETS[platform, arch]
    header = library.read(64)
    valid = False
    if len(header) == 64 and platform == "linux" and header.startswith(b"\x7fELF\x02\x01\x01"):
        valid = unpack_from("<HH", header, 16) == (3, machine)  # ET_DYN 与 e_machine
    elif len(header) == 64 and platform == "windows" and header.startswith(b"MZ"):
        library.seek(unpack_from("<I", header, 60)[0])
        pe_header = library.read(26)
        if len(pe_header) == 26 and pe_header.startswith(b"PE\x00\x00"):
            architecture = unpack_from("<H", pe_header, 4)[0]
            characteristics, optional_magic = unpack_from("<HH", pe_header, 22)
            valid = architecture == machine and bool(characteristics & 0x2000) and optional_magic == 0x20B
    if not valid:
        raise ValueError(f"动态库格式或架构不符，期望 {platform}/{arch}")


def verify_build(artifact, platform, arch, source):
    result = subprocess.run(
        [source.go_exe, "version", "-m", "-json", str(artifact)],
        capture_output=True, text=True, encoding="utf-8", check=False,
    )
    if result.returncode or not result.stdout.strip():
        raise ValueError(f"无法读取 {platform}/{arch} 的 Go 构建信息：{result.stderr.strip()}")
    info = json.loads(result.stdout)
    main = info.get("Main") or {}
    actual = {setting["Key"]: setting["Value"] for setting in info.get("Settings", [])}
    actual.update({"路径": info.get("Path"), "模块路径": main.get("Path"), "模块版本": main.get("Version")})
    expected = {
        "路径": source.module + "/cmd/downshift",
        "模块路径": source.module,
        "模块版本": source.tag,
        "-buildmode": "c-shared",
        "CGO_ENABLED": "1",
        "GOOS": platform,
        "GOARCH": arch,
        "vcs": "git",
        "vcs.revision": source.revision,
        "vcs.modified": "false",
    }
    differences = [f"{key} 期望 {value!r}、实际 {actual.get(key)!r}" for key, value in expected.items() if actual.get(key) != value]
    if differences:
        raise ValueError(f"{platform}/{arch} 构建信息不一致：" + "，".join(differences))


def verify_archive(archive, plugin_id, platform, arch, source=None):
    entry = plugin_id + PLATFORMS[platform]
    with ZipFile(archive) as bundle:
        if sorted(bundle.namelist()) != sorted((entry, *NOTICES)) or bundle.testzip():
            raise ValueError(f"发布包结构或内容无效：{archive.name}")
        with bundle.open(entry) as library:
            verify_library(library, platform, arch)
            if source:
                with TemporaryDirectory(prefix="verify-", dir=archive.parent) as directory:
                    artifact = Path(directory) / ("plugin" + PLATFORMS[platform])
                    library.seek(0)
                    with artifact.open("wb") as file:
                        copyfileobj(library, file)
                    verify_build(artifact, platform, arch, source)


def package_library(plugin_id, version, platform, arch, output, source=None):
    extension = PLATFORMS[platform]
    library = ROOT / "build" / platform / arch / f"{plugin_id}-v{version}{extension}"
    archive = output / archive_name(plugin_id, version, platform, arch)
    temporary = archive.with_suffix(".zip.tmp")
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED) as bundle:
            bundle.write(library, plugin_id + extension)
            for notice in NOTICES:
                bundle.write(ROOT / notice, notice)
        verify_archive(temporary, plugin_id, platform, arch, source)
        os.replace(temporary, archive)
    finally:
        temporary.unlink(missing_ok=True)


def write_checksums(plugin_id, version, output, source=None):
    lines = []
    for platform, arch in TARGETS:
        archive = output / archive_name(plugin_id, version, platform, arch)
        verify_archive(archive, plugin_id, platform, arch, source)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        lines.append(f"{digest}  {archive.name}\n")
    (output / "checksums.txt").write_bytes("".join(lines).encode("ascii"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--platform", choices=PLATFORMS, help="打包一个已编译的平台")
    action.add_argument("--checksums", action="store_true", help="验证三个目标的归档并生成 checksums.txt")
    parser.add_argument("--arch", choices=("amd64", "arm64"), help="打包目标架构，默认为 amd64")
    parser.add_argument("--tag", help="核对发布标签，例如 v0.1.5")
    parser.add_argument("--go-exe", default="go", help="读取 Go 构建信息的命令或路径，默认为 go")
    args = parser.parse_args()
    arch = args.arch or "amd64"
    if args.checksums and args.arch:
        parser.error("--arch 只能与 --platform 一起使用")
    if args.platform and (args.platform, arch) not in TARGETS:
        parser.error(f"不支持的打包目标：{args.platform}/{arch}")
    plugin_id, version = release_identity(args.tag)
    source = release_source(args.tag, args.go_exe)
    output = ROOT / "build" / "release" / version
    output.mkdir(parents=True, exist_ok=True)
    if args.platform:
        package_library(plugin_id, version, args.platform, arch, output, source)
    else:
        write_checksums(plugin_id, version, output, source)
