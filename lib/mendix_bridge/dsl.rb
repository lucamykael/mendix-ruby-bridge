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
        @user_roles = []
        @project_security = nil
      end

      def modulo(name, &block)
        add_module(name, &block)
      end

      def app_module(name, &block)
        add_module(name, &block)
      end

      def user_role(name, module_roles:, manage_all_roles: false)
        raise ArgumentError, "duplicate user role: #{name}" if
          @user_roles.any? { |role| role.name == name.to_s }

        roles = Array(module_roles).map(&:to_s)
        raise ArgumentError, "user role #{name} requires module roles" if roles.empty?

        @user_roles << Model::UserRole.new(
          name: name.to_s,
          module_roles: roles,
          manage_all_roles:
        )
      end

      def project_security(level:, demo_users: false)
        raise ArgumentError, "project security is already declared" if @project_security

        normalized_level = level.to_s.downcase
        unless %w[off prototype production].include?(normalized_level)
          raise ArgumentError, "security level must be off, prototype, or production"
        end

        @project_security = Model::ProjectSecurity.new(
          level: normalized_level,
          demo_users: !!demo_users
        )
      end

      def result
        Model::App.new(
          name: @name,
          version: @version,
          modules: @modules,
          user_roles: @user_roles,
          project_security: @project_security
        )
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
        @microflows = []
        @pages = []
        @module_roles = []
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

      def microflow(name, returns: nil, folder: nil, &block)
        if @microflows.any? { |microflow| microflow.name == name.to_s }
          raise ArgumentError, "duplicate microflow: #{name}"
        end

        @microflows << MicroflowBuilder.build(
          name,
          returns:,
          folder:,
          &block
        )
      end

      def page(name, title:, layout:, folder: nil, &block)
        raise ArgumentError, "duplicate page: #{name}" if
          @pages.any? { |page| page.name == name.to_s }

        @pages << PageBuilder.build(
          name,
          title:,
          layout:,
          folder:,
          &block
        )
      end

      def module_role(name, description: nil)
        raise ArgumentError, "duplicate module role: #{name}" if
          @module_roles.any? { |role| role.name == name.to_s }

        @module_roles << Model::ModuleRole.new(
          name: name.to_s,
          description: description&.to_s
        )
      end

      def result
        Model::AppModule.new(
          name: @name,
          entities: @entities,
          enumerations: @enumerations,
          microflows: @microflows,
          pages: @pages,
          module_roles: @module_roles
        )
      end
    end

    class PageBuilder
      def self.build(name, title:, layout:, folder: nil, &block)
        builder = new(name, title, layout, folder)
        builder.instance_eval(&block) if block
        builder.result
      end

      def initialize(name, title, layout, folder)
        @name = name.to_s
        @title = title.to_s
        @layout = layout.to_s
        @folder = folder&.to_s
        @parameters = []
        @content = nil
        @view_roles = []
      end

      def parameter(name, type)
        if @parameters.any? { |parameter| parameter.name == name.to_s }
          raise ArgumentError, "duplicate page parameter: #{name}"
        end

        @parameters << Model::FlowParameter.new(name: name.to_s, type: type.to_s)
      end

      def content(source)
        raise ArgumentError, "page content is already declared" if @content

        @content = source.to_s.strip
      end

      def view_role(role)
        role = role.to_s
        raise ArgumentError, "duplicate view role: #{role}" if @view_roles.include?(role)

        @view_roles << role
      end

      def result
        raise ArgumentError, "page #{@name} requires content" if @content.nil? || @content.empty?

        Model::Page.new(
          name: @name,
          title: @title,
          layout: @layout,
          folder: @folder,
          parameters: @parameters,
          content: @content,
          view_roles: @view_roles
        )
      end
    end

    class MicroflowBuilder
      def self.build(name, returns: nil, folder: nil, &block)
        builder = new(name, returns, folder)
        builder.instance_eval(&block) if block
        builder.result
      end

      def initialize(name, returns, folder)
        @name = name.to_s
        @return_type = returns&.to_s
        @folder = folder&.to_s
        @parameters = []
        @body = nil
        @execute_roles = []
      end

      def parameter(name, type)
        if @parameters.any? { |parameter| parameter.name == name.to_s }
          raise ArgumentError, "duplicate microflow parameter: #{name}"
        end

        @parameters << Model::FlowParameter.new(name: name.to_s, type: type.to_s)
      end

      def body(source)
        raise ArgumentError, "microflow body is already declared" if @body

        @body = source.to_s.strip
      end

      def execute_role(role)
        role = role.to_s
        raise ArgumentError, "duplicate execute role: #{role}" if @execute_roles.include?(role)

        @execute_roles << role
      end

      def result
        raise ArgumentError, "microflow #{@name} requires a body" if @body.nil? || @body.empty?

        Model::Microflow.new(
          name: @name,
          parameters: @parameters,
          return_type: @return_type,
          folder: @folder,
          body: @body,
          execute_roles: @execute_roles
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
        @access_rules = []
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

      def access(
        role,
        create: false,
        delete: false,
        read: [],
        write: [],
        where: nil
      )
        role = role.to_s
        raise ArgumentError, "duplicate entity access role: #{role}" if
          @access_rules.any? { |rule| rule.role == role }

        @access_rules << Model::AccessRule.new(
          role:,
          create: !!create,
          delete: !!delete,
          read: access_attributes(read),
          write: access_attributes(write),
          xpath: where&.to_s
        )
      end

      def result
        Model::Entity.new(
          name: @name,
          persistable: @persistable,
          attributes: @attributes,
          associations: @associations,
          access_rules: @access_rules
        )
      end

      private

      def ensure_unique!(items, name, kind)
        return unless items.any? { |item| item.name == name.to_s }

        raise ArgumentError, "duplicate #{kind}: #{name}"
      end

      def access_attributes(value)
        return "*" if value == :all || value == "*"

        Array(value).map(&:to_s)
      end
    end
  end
end
