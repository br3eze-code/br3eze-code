{
  description = "AgentOS - Domain-agnostic AI agent platform";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        # Use Node.js 22 (LTS) – matches CI and package.json engines field
        nodejs = pkgs.nodejs_22;

        agentos = pkgs.buildNpmPackage {
          pname   = "agentos";
          version = "1.0.0";
          src     = ./.;

          # Update this hash with: nix-prefetch-git or by running nix build once
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

          buildInputs      = [ nodejs ];
          nativeBuildInputs = [ pkgs.makeWrapper ];

          # Skip lifecycle hooks that may require native toolchain during build
          npmFlags = [ "--ignore-scripts" ];

          postInstall = ''
            makeWrapper ${nodejs}/bin/node $out/bin/agentos \
              --add-flags "$out/lib/node_modules/agentos/bin/agentos.js" \
              --prefix PATH : ${pkgs.lib.makeBinPath [ nodejs ]}
          '';

          meta = with pkgs.lib; {
            description = "AI-powered multi-channel agent platform with OpenClaw integration";
            homepage    = "https://github.com/br3eze-code/agentos";
            license     = licenses.asl20;
            maintainers = [ "Brighton Mzacana" ];
            platforms   = platforms.unix;
          };
        };
      in {
        packages = {
          default = agentos;
          agentos = agentos;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [ nodejs pkgs.git ];
          shellHook = ''
            echo "AgentOS development environment (Node $(node --version))"
            npm install
          '';
        };
      });
}
