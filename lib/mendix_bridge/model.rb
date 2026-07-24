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

    AppModule = Data.define(:name, :entities) do
      def to_h
        { name:, entities: entities.map(&:to_h) }
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
