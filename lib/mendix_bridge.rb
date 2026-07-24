# frozen_string_literal: true

require "json"
require "set"
require_relative "mendix_bridge/model"
require_relative "mendix_bridge/dsl"
require_relative "mendix_bridge/mdl_generator"
require_relative "mendix_bridge/validator"
require_relative "mendix_bridge/inventory"
require_relative "mendix_bridge/domain_parser"
require_relative "mendix_bridge/enumeration_parser"
require_relative "mendix_bridge/document_parser"
require_relative "mendix_bridge/microflow_parser"
require_relative "mendix_bridge/page_parser"
require_relative "mendix_bridge/security_parser"
require_relative "mendix_bridge/ruby_inventory_generator"
require_relative "mendix_bridge/snapshot_diff"
require_relative "mendix_bridge/presenter"
require_relative "mendix_bridge/change_planner"
require_relative "mendix_bridge/importer"
require_relative "mendix_bridge/project_creator"
require_relative "mendix_bridge/html_viewer"
require_relative "mendix_bridge/git_workflow"

module MendixBridge
  class << self
    def app(name, version: nil, &block)
      DSL::AppBuilder.build(name, version:, &block)
    end

    def generate(format: :json, pretty: true, &block)
      model = DSL::RootBuilder.build(&block)
      validate!(model)
      serialize(model, format:, pretty:)
    end

    def compile(
      model,
      format: :json,
      pretty: true,
      skip_associations: [],
      skip_module_roles: [],
      skip_user_roles: [],
      include_modules: false,
      skip_modules: []
    )
      validate!(model)
      serialize(
        model,
        format:,
        pretty:,
        skip_associations:,
        skip_module_roles:,
        skip_user_roles:,
        include_modules:,
        skip_modules:
      )
    end

    def validate!(model)
      Validator.validate!(model)
      model
    end

    def load_file(path)
      source = File.read(path)
      model = eval(source, TOPLEVEL_BINDING, path) # rubocop:disable Security/Eval

      unless model.is_a?(Model::App)
        raise ArgumentError, "#{path} must return a MendixBridge application model"
      end

      validate!(model)
    end

    private

    def serialize(
      model,
      format:,
      pretty:,
      skip_associations: [],
      skip_module_roles: [],
      skip_user_roles: [],
      include_modules: false,
      skip_modules: []
    )
      case format.to_sym
      when :json
        pretty ? JSON.pretty_generate(model.to_h) : JSON.generate(model.to_h)
      when :mdl
        MDLGenerator.generate(
          model,
          skip_associations:,
          skip_module_roles:,
          skip_user_roles:,
          include_modules:,
          skip_modules:
        )
      else
        raise ArgumentError, "unsupported output format: #{format}"
      end
    end
  end
end
