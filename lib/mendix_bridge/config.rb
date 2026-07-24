# frozen_string_literal: true

require "pathname"
require "yaml"

module MendixBridge
  class ConfigError < StandardError; end

  class Config
    FILE_NAME = ".mendix-ruby.yml"
    KEYS = %w[project inventory model].freeze

    attr_reader :path

    def self.find(start_dir = Dir.pwd)
      directory = Pathname.new(File.expand_path(start_dir))
      loop do
        candidate = directory.join(FILE_NAME)
        return load(candidate.to_s) if candidate.file?
        break if directory.root?

        directory = directory.parent
      end
      nil
    end

    def self.load(path)
      path = File.expand_path(path)
      data = YAML.safe_load_file(path, permitted_classes: [], aliases: false)
      raise ConfigError, "configuration root must be a mapping: #{path}" unless
        data.is_a?(Hash)
      raise ConfigError, "unsupported configuration version" unless data["version"] == 1

      unknown = data.keys - ["version", *KEYS]
      raise ConfigError, "unknown configuration keys: #{unknown.join(', ')}" unless
        unknown.empty?

      new(path, data)
    rescue Psych::Exception => error
      raise ConfigError, "invalid configuration #{path}: #{error.message}"
    end

    def self.write(path, project:, inventory:, model:, force: false)
      path = File.expand_path(path)
      raise ConfigError, "configuration already exists: #{path}" if
        File.exist?(path) && !force

      base = File.dirname(path)
      data = {
        "version" => 1,
        "project" => relative_path(project, base),
        "inventory" => relative_path(inventory, base),
        "model" => relative_path(model, base)
      }
      File.write(path, YAML.dump(data))
      load(path)
    end

    def initialize(path, data)
      @path = path
      @data = data
    end

    KEYS.each do |key|
      define_method(key) do
        value = @data[key]
        value && File.expand_path(value, File.dirname(path))
      end
    end

    def to_h
      {
        "path" => path,
        "project" => project,
        "inventory" => inventory,
        "model" => model
      }
    end

    def self.relative_path(value, base)
      Pathname.new(File.expand_path(value)).relative_path_from(
        Pathname.new(File.expand_path(base))
      ).to_s
    rescue ArgumentError
      File.expand_path(value)
    end
    private_class_method :relative_path
  end
end
