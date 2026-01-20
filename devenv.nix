{ pkgs, lib, config, inputs, ... }:

{
  dotenv.enable = true;
  
  # https://devenv.sh/packages/
  packages = with pkgs; [ just git typescript-language-server ];

  # https://devenv.sh/languages/
  languages.javascript.enable = true;
  languages.javascript.bun.enable = true;

  # https://devenv.sh/integrations/claude-code
  claude.code.enable = true;
  claude.code.mcpServers = {
    # Local devenv MCP server
    devenv = {
      type = "stdio";
      command = "devenv";
      args = [ "mcp" ];
      env = {
        DEVENV_ROOT = config.devenv.root;
      };
    };
    docs-langchain = {
      type = "http";
      url = "https://docs.langchain.com/mcp";
    };
    docs-bun = {
      type = "http";
      url = "https://bun.com/docs/mcp";
    };
  };

  # See full reference at https://devenv.sh/reference/options/
}
