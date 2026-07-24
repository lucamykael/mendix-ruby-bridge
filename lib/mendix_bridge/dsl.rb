# frozen_string_literal: true

module MendixBridge
  module DSL
    class RootBuilder
      def self.build(&block)
        builder = new
        builder.instance_eval(&block)
        builder.result
      end

      def app(name, version: nil, &block)
        raise ArgumentError, "only one app can be declared" if @app

        @app = AppBuilder.build(name, version:, &block)
      end

      def result
        @app || raise(ArgumentError, "an app declaration is required")
      end
    end

    class AppBuilder
      def self.build(name, version: nil, &block)
        builder = new(name, version)
        builder.instance_eval(&block) if block
        builder.result
      end

      def initialize(name, version)
        @name = name.to_s
        @version = version&.to_s
        @modules = []
      end

      def modulo(name, &block)
        add_module(name, &block)
      end

      def app_module(name, &block)
        add_module(name, &block)
      end

      def result
        Model::App.new(name: @name, version: @version, modules: @modules)
      end

      private

      def add_module(name, &block)
        ensure_unique!(@modules, name, "module")
        @modules << ModuleBuilder.build(name, &block)
      end

      def ensure_unique!(items, name, kind)
        return unless items.any? { |item| item.name == name.to_s }

        raise ArgumentError, "duplicate #{kind}: #{name}"
      end
    end

    class ModuleBuilder
      def self.build(name, &block)
        builder = new(name)
        builder.instance_eval(&block) if block
        builder.result
      end

      def initialize(name)
        @name = name.to_s
        @entities = []
        @enumerations = []
      end

      def entity(name, persistable: true, &block)
        if @entities.any? { |entity| entity.name == name.to_s }
          raise ArgumentError, "duplicate entity: #{name}"
        end

        @entities << EntityBuilder.build(name, persistable:, &block)
      end

      def enumeration(name, folder: nil, &block)
        if @enumerations.any? { |enumeration| enumeration.name == name.to_s }
          raise ArgumentError, "duplicate enumeration: #{name}"
        end

        @enumerations << EnumerationBuilder.build(name, folder:, &block)
      end

      def result
        Model::AppModule.new(
          name: @name,
          entities: @entities,
          enumerations: @enumerations
        )
      end
    end

    class EnumerationBuilder
      def self.build(name, folder: nil, &block)
        builder = new(name, folder)
        builder.instance_eval(&block) if block
        builder.result
      end

      def initialize(name, folder)
        @name = name.to_s
        @folder = folder&.to_s
        @values = []
      end

      def value(name, caption: nil)
        if @values.any? { |value| value.name == name.to_s }
          raise ArgumentError, "duplicate enumeration value: #{name}"
        end

        @values << Model::EnumerationValue.new(
          name: name.to_s,
          caption: (caption || name).to_s
        )
      end

      def result
        raise ArgumentError, "enumeration #{@name} requires at least one value" if @values.empty?

        Model::Enumeration.new(name: @name, folder: @folder, values: @values)
      end
    end

    class EntityBuilder
      CARDINALITIES = %i[one many].freeze
      ATTRIBUTE_TYPES = %i[
        autonumber binary boolean datetime decimal enumeration
        hash_string integer long string
      ].freeze

      def self.build(name, persistable: true, &block)
        builder = new(name, persistable)
        builder.instance_eval(&block) if block
        builder.result
      end

      def initialize(name, persistable)
        @name = name.to_s
        @persistable = persistable
        @attributes = []
        @associations = []
      end

      def attribute(
        name,
        type,
        required: false,
        default: nil,
        length: 200,
        enumeration: nil
      )
        type = type.to_sym
        unless ATTRIBUTE_TYPES.include?(type)
          raise ArgumentError,
            "unsupported attribute type #{type.inspect}; " \
            "expected one of: #{ATTRIBUTE_TYPES.join(', ')}"
        end

        ensure_unique!(@attributes, name, "attribute")
        if type == :enumeration && enumeration.nil?
          raise ArgumentError, "enumeration attributes require enumeration: \"Module.Name\""
        end

        options = case type
        when :string
          { length: }
        when :enumeration
          { enumeration: enumeration.to_s }
        else
          {}
        end

        @attributes << Model::Attribute.new(
          name: name.to_s,
          type: type.to_s,
          required:,
          default:,
          options:
        )
      end

      def association(name, target:, cardinality: :one, owner: :default)
        cardinality = cardinality.to_sym
        unless CARDINALITIES.include?(cardinality)
          raise ArgumentError, "cardinality must be :one or :many"
        end

        ensure_unique!(@associations, name, "association")
        @associations << Model::Association.new(
          name: name.to_s,
          target: target.to_s,
          cardinality: cardinality.to_s,
          owner: owner.to_s
        )
      end

      def result
        Model::Entity.new(
          name: @name,
          persistable: @persistable,
          attributes: @attributes,
          associations: @associations
        )
      end

      private

      def ensure_unique!(items, name, kind)
        return unless items.any? { |item| item.name == name.to_s }

        raise ArgumentError, "duplicate #{kind}: #{name}"
      end
    end
  end
end
