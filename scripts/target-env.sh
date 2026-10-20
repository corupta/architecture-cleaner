# Source before running a target's own commands:  . scripts/target-env.sh <node-version|system>
# Project-local Node from ~/ac-targets/.node, corepack-managed package managers, shared caches under ~/ac-targets.
# Requires `npm run build` (for dist/oracles/block-net.cjs) before ac_offline.
ac_repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ac_node_version=${1:-system}
if [ "$ac_node_version" != system ]; then
  # Node's Linux builds: node-v<version>-linux-x64 or -linux-arm64, unpacked under ~/ac-targets/.node.
  case "$(uname -s)/$(uname -m)" in
    Linux/x86_64) ac_node_arch=x64 ;;
    Linux/aarch64 | Linux/arm64) ac_node_arch=arm64 ;;
    *)
      echo "target-env.sh: no Node build for $(uname -s) $(uname -m): the targets' Node is linux-x64 (x86_64) or linux-arm64 (aarch64, arm64)" >&2
      return 1 2>/dev/null || exit 1
      ;;
  esac
  ac_node_directory="$HOME/ac-targets/.node/node-v$ac_node_version-linux-$ac_node_arch"
  if [ ! -x "$ac_node_directory/bin/node" ]; then
    echo "target-env.sh: Node $ac_node_version is not installed: no $ac_node_directory/bin/node" >&2
    return 1 2>/dev/null || exit 1
  fi
  export PATH="$ac_node_directory/bin:$PATH"
fi
export COREPACK_HOME="$HOME/ac-targets/.corepack"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export COREPACK_ENABLE_STRICT=0
export npm_config_store_dir="$HOME/ac-targets/.pnpm-store"
export pnpm_config_store_dir="$HOME/ac-targets/.pnpm-store"  # pnpm 11 reads only this one
export npm_config_cache="$HOME/ac-targets/.npm-cache"
export YARN_CACHE_FOLDER="$HOME/ac-targets/.yarn-cache"
export YARN_GLOBAL_FOLDER="$HOME/ac-targets/.yarn-global"
export HUSKY=0
export CI=true
hash -r
# ac_offline <netlog>: block network for Node processes (preload) and point proxies at a dead port.
ac_offline() {
  export AC_NET_LOG="${1:?netlog path}"
  export NODE_OPTIONS="--require $ac_repo_root/dist/oracles/block-net.cjs ${NODE_OPTIONS:-}"
  export HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9
  export http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY all_proxy=$ALL_PROXY
  export NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1
}
