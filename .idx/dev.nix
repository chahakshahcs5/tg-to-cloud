# To learn more about how to use Nix to configure your environment
# see: https://developers.google.com/idx/guides/customize-idx-env
{ pkgs, ... }: {
  # Which nixpkgs channel to use.
  channel = "stable-24.05"; # or "unstable"
  # Use https://search.nixos.org/packages to find packages
  packages = [
    pkgs.python311
  ];
  # Sets environment variables in the workspace
  env = { };
  idx = {
    # Search for the extensions you want on https://open-vsx.org/ and use "publisher.id"
    extensions = [
      "ms-python.python"
      "EricSia.pythonsnippets3"
      "mikoz.black-py"
    ];
    # Workspace lifecycle hooks
    workspace = {
      # Runs when a workspace is first created
      onCreate = {
        venv = "python3 -m venv .venv";
        activate = "source venv/bin/activate";
        install = "python3 -m pip install -r requirements.txt";
        install-js = "npm install";
        # Open editors for the following files by default, if they exist:
        default.openFiles = [ "main.py" ];
      };
      # Runs when the workspace is (re)startedpython 
      onStart = {
        # Example: start a background task to watch and re-build backend code
        run-application = "source /home/user/tg-to-cloud-python/.venv/bin/activate && python3 main.py";
      };
    };
  };
  services = {
    mongodb = {
      enable = true;
      port = 27017;
    };
  };
}
