# frozen_string_literal: true

module MendixBridge
  class SnapshotDiff
    Result = Data.define(:added, :modified, :removed) do
      def empty?
        added.empty? && modified.empty? && removed.empty?
      end

      def to_h
        { added:, modified:, removed: }
      end
    end

    def self.compare(before, after)
      old_elements = index(before)
      new_elements = index(after)
      old_keys = old_elements.keys
      new_keys = new_elements.keys

      Result.new(
        added: describe(new_keys - old_keys, new_elements),
        modified: describe(
          (old_keys & new_keys).select do |key|
            canonical(old_elements.fetch(key)) != canonical(new_elements.fetch(key))
          end,
          new_elements
        ),
        removed: describe(old_keys - new_keys, old_elements)
      )
    end

    def self.index(inventory)
      inventory.elements.to_h do |element|
        identity = element.qualified_name || element.path.join("/")
        ["#{element.type}:#{identity}", element]
      end
    end

    def self.describe(keys, elements)
      keys.sort.map do |key|
        element = elements.fetch(key)
        {
          "id" => key,
          "type" => element.type,
          "name" => element.qualified_name || element.label,
          "path" => element.path
        }.compact
      end
    end

    def self.canonical(element)
      JSON.generate(element.to_h)
    end

    private_class_method :index, :describe, :canonical
  end
end
