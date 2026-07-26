# frozen_string_literal: true

module MendixBridge
  class DesktopApp
    def initialize(inventory_dir:, bridge_dir: nil)
      @inventory_dir = File.expand_path(inventory_dir)
      @bridge_dir = bridge_dir || File.expand_path("../..", __dir__)
    end

    def run
      launcher = File.join(@bridge_dir, "bin", "mendix-desktop")
      unless File.exist?(launcher)
        abort "mendix-desktop launcher not found: #{launcher}"
      end

      exec("python3", launcher, @inventory_dir)
    end
  end
end
