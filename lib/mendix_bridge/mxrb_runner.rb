# frozen_string_literal: true

require "open3"

module MendixBridge
  class MxrbError < StandardError; end

  # Thin wrapper around the mxrb CLI binary.
  # Resolves the binary once and provides run/run! helpers used throughout the
  # bridge. Replaces the old ad-hoc @mxcli + Open3.capture3 pattern.
  class MxrbRunner
    BINARY = "mxrb"

    def self.resolve
      path = `which #{BINARY} 2>/dev/null`.strip
      path.empty? ? BINARY : path
    end

    def initialize(binary: self.class.resolve)
      @binary = binary
    end

    attr_reader :binary

    def executable?
      File.executable?(@binary) || !`which #{@binary} 2>/dev/null`.strip.empty?
    end

    # Runs mxrb with the given arguments. Returns [stdout, stderr, status].
    def run(*args)
      Open3.capture3(@binary, *args)
    end

    # Like run, but raises MxrbError on non-zero exit.
    def run!(*args, error_prefix: "mxrb")
      stdout, stderr, status = run(*args)
      return stdout if status.success?

      detail = clean_output(stderr.empty? ? stdout : stderr)
      raise MxrbError, "#{error_prefix}: #{detail}"
    end

    # Convenience: parse JSON output from a mxrb --json command.
    def run_json(*args, error_prefix: "mxrb")
      out = run!(*args, error_prefix:)
      JSON.parse(out)
    rescue JSON::ParserError => e
      raise MxrbError, "#{error_prefix}: invalid JSON — #{e.message}"
    end

    private

    def clean_output(text)
      text.lines
          .reject { |l| l.start_with?("[mxrb]") || l.strip.empty? }
          .first(10)
          .join
          .strip
    end
  end
end
