# frozen_string_literal: true

module MendixBridge
  module Model
    Attribute = Data.define(:name, :type, :required, :default, :options) do
      def to_h
        { name:, type:, required:, default:, **options }.compact
      end
    end

    Association = Data.define(:name, :target, :cardinality, :owner) do
      def to_h
        { name:, target:, cardinality:, owner: }.compact
      end
    end

    Entity = Data.define(:name, :persistable, :attributes, :associations) do
      def to_h
        {
          name:,
          persistable:,
          attributes: attributes.map(&:to_h),
          associations: associations.map(&:to_h)
        }
      end
    end

    EnumerationValue = Data.define(:name, :caption) do
      def to_h
        { name:, caption: }
      end
    end

    Enumeration = Data.define(:name, :folder, :values) do
      def to_h
        { name:, folder:, values: values.map(&:to_h) }.compact
      end
    end

    FlowParameter = Data.define(:name, :type) do
      def to_h
        { name:, type: }
      end
    end

    Microflow = Data.define(
      :name,
      :parameters,
      :return_type,
      :folder,
      :body,
      :execute_roles
    ) do
      def to_h
        {
          name:,
          parameters: parameters.map(&:to_h),
          return_type:,
          folder:,
          body:,
          execute_roles:
        }.compact
      end
    end

    Page = Data.define(
      :name,
      :title,
      :layout,
      :folder,
      :parameters,
      :content,
      :view_roles
    ) do
      def to_h
        {
          name:,
          title:,
          layout:,
          folder:,
          parameters: parameters.map(&:to_h),
          content:,
          view_roles:
        }.compact
      end
    end

    AppModule = Data.define(:name, :entities, :enumerations, :microflows, :pages) do
      def to_h
        {
          name:,
          entities: entities.map(&:to_h),
          enumerations: enumerations.map(&:to_h),
          microflows: microflows.map(&:to_h),
          pages: pages.map(&:to_h)
        }
      end
    end

    App = Data.define(:name, :version, :modules) do
      def to_h
        {
          schema_version: 1,
          app: { name:, version: }.compact,
          modules: modules.map(&:to_h)
        }
      end
    end
  end
end
