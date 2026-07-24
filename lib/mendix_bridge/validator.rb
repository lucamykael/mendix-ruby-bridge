# frozen_string_literal: true

module MendixBridge
  class ValidationError < StandardError; end

  class Validator
    def self.validate!(model)
      new(model).validate!
    end

    def initialize(model)
      @model = model
    end

    def validate!
      errors = []
      entities = entity_index

      @model.modules.each do |app_module|
        app_module.entities.each do |entity|
          entity.associations.each do |association|
            next if entities.include?(association.target)

            errors << "#{app_module.name}.#{entity.name}.#{association.name} " \
              "targets unknown entity #{association.target}"
          end
        end
      end

      raise ValidationError, errors.join("\n") unless errors.empty?

      @model
    end

    private

    def entity_index
      @model.modules.each_with_object([]) do |app_module, names|
        app_module.entities.each do |entity|
          names << "#{app_module.name}.#{entity.name}"
        end
      end
    end
  end
end

