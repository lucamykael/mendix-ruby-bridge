# frozen_string_literal: true

require "socket"
require "timeout"

module MendixBridge
  class DesktopApp
    APP_TITLE = "Mendix Ruby Bridge"
    WINDOW_WIDTH = 1280
    WINDOW_HEIGHT = 800
    READY_TIMEOUT = 15

    def initialize(inventory_dir:, bridge_dir: nil)
      @inventory_dir = File.expand_path(inventory_dir)
      @bridge_dir = bridge_dir || File.expand_path("../..", __dir__)
      @server_thread = nil
      @backend = nil
    end

    def run
      require_gtk!
      configure_env!

      port = free_port
      start_backend(port)
      wait_for_backend(port)

      Gtk.init
      window = build_window(port)
      window.show_all
      Gtk.main
    ensure
      @backend&.shutdown
      @server_thread&.kill
    end

    private

    def configure_env!
      # WebKit2GTK crashes on Wayland with a protocol error; XWayland is stable.
      # GPU compositing also fails on XWayland with some drivers (GBM buffer errors).
      ENV["GDK_BACKEND"] ||= "x11"
      ENV["WEBKIT_DISABLE_COMPOSITING_MODE"] ||= "1"
    end

    def require_gtk!
      require "gtk3"
      require "webkit2-gtk"
    rescue LoadError => e
      abort <<~MSG
        mendix-desktop requires GTK3 and WebKit2 Ruby bindings.

        Install them with:
          gem install gtk3 webkit2-gtk

        Or install the system packages:
          Ubuntu/Debian: sudo apt install ruby-gtk3 gir1.2-webkit2-4.0
          Arch/Omarchy:  sudo pacman -S ruby-gtk3 webkit2gtk

        Original error: #{e.message}
      MSG
    end

    def free_port
      server = TCPServer.new("127.0.0.1", 0)
      port = server.addr[1]
      server.close
      port
    end

    def start_backend(port)
      web_root = File.join(@bridge_dir, "web", "dist")

      @server_thread = Thread.new do
        @backend = BackendServer.new(
          inventory_dir: @inventory_dir,
          web_root: web_root,
          runner: MxrbRunner.new,
          bind: "127.0.0.1",
          port: port
        )
        @backend.start
      rescue => e
        warn "mendix-desktop: backend error: #{e.message}"
      end
      @server_thread.abort_on_exception = false
    end

    def wait_for_backend(port)
      Timeout.timeout(READY_TIMEOUT) do
        loop do
          TCPSocket.new("127.0.0.1", port).close
          break
        rescue Errno::ECONNREFUSED, Errno::EHOSTUNREACH
          sleep 0.1
        end
      end
    rescue Timeout::Error
      abort "mendix-desktop: backend did not start within #{READY_TIMEOUT}s"
    end

    def build_window(port)
      window = Gtk::Window.new
      window.title = APP_TITLE
      window.set_default_size(WINDOW_WIDTH, WINDOW_HEIGHT)
      window.set_window_position(:center)

      webview = WebKit2Gtk::WebView.new
      webview.load_uri("http://127.0.0.1:#{port}")

      window.add(webview)
      window.signal_connect("destroy") do
        @backend&.shutdown
        Gtk.main_quit
      end

      window
    end
  end
end
