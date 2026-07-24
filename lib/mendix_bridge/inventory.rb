# frozen_string_literal: true

module MendixBridge
  class Inventory
    Element = Data.define(:label, :type, :qualified_name, :path, :raw, :details) do
      def module_name
        qualified_name&.split(".", 2)&.first
      end

      def to_h
        {
          label:,
          type:,
          qualified_name:,
          path:,
          raw:,
          details:
        }.compact
      end
    end

    attr_reader :tree, :elements

    def self.from_json(json, details: {})
      new(JSON.parse(json), details:)
    end

    def self.load(path, details_path: nil)
      details_path ||= begin
        directory = File.dirname(path)
        current = File.join(directory, "element-details.json")
        File.file?(current) ? current : File.join(directory, "domain-details.json")
      end
      details = File.file?(details_path) ? JSON.parse(File.read(details_path)) : {}
      from_json(File.read(path), details:)
    end

    def initialize(tree, details: {})
      raise ArgumentError, "inventory root must be an array" unless tree.is_a?(Array)

      @tree = tree
      @details = details
      @elements = flatten(tree).freeze
    end

    def search(query)
      needle = query.to_s.downcase
      elements.select do |element|
        [element.label, element.qualified_name, element.type]
          .compact
          .any? { |value| value.downcase.include?(needle) }
      end
    end

    def of_type(type)
      expected = type.to_s.downcase
      elements.select { |element| element.type&.downcase == expected }
    end

    def modules
      of_type("module")
    end

    def find(qualified_name)
      elements.find { |element| element.qualified_name == qualified_name }
    end

    def types
      elements.each_with_object(Hash.new(0)) do |element, counts|
        counts[element.type] += 1 if element.type
      end.sort.to_h
    end

    private

    def flatten(nodes, parents = [])
      nodes.flat_map do |node|
        label = node["label"]
        path = [*parents, label].compact
        element = Element.new(
          label:,
          type: node["type"],
          qualified_name: node["qualifiedName"],
          path:,
          raw: node,
          details: @details[node["qualifiedName"]]
        )

        [element, *flatten(node.fetch("children", []), path)]
      end
    end
  end
end
