# frozen_string_literal: true

module MendixBridge
  class DependencyIndex
    Edge = Data.define(:from, :to, :kind, :path) do
      def to_h
        { from:, to:, kind:, path: }
      end
    end

    UNQUALIFIED_REFERENCE_KEYS = %w[
      included_in_user_roles manageable_roles
    ].freeze

    KIND_KEYS = {
      "calls" => "call",
      "microflow_calls" => "microflow_call",
      "nanoflow_calls" => "nanoflow_call",
      "javascript_action_calls" => "javascript_action_call",
      "page_links" => "page_link",
      "layout" => "layout",
      "structure" => "mapping_structure",
      "generalization" => "generalization",
      "from" => "association_source",
      "to" => "association_target",
      "execute_roles" => "execute_role",
      "view_roles" => "view_role",
      "module_roles" => "module_role",
      "role" => "security_role",
      "home_page" => "navigation_home",
      "login_page" => "navigation_login",
      "not_found_page" => "navigation_not_found",
      "target" => "target",
      "type" => "type_reference"
    }.freeze

    attr_reader :edges

    def self.load(path, inventory:)
      data = JSON.parse(File.read(path))
      edges = data.fetch("edges").map do |edge|
        Edge.new(
          from: edge.fetch("from"),
          to: edge.fetch("to"),
          kind: edge.fetch("kind"),
          path: edge.fetch("path")
        )
      end
      new(inventory, edges:)
    end

    def initialize(inventory, edges: nil)
      @inventory = inventory
      @names = inventory.elements.filter_map(&:qualified_name).to_set
      @qualified_names = @names.select { |name| name.include?(".") }.to_set
      @edges = (edges || build_edges).freeze
    end

    def dependencies(name, transitive: false)
      traverse(name, direction: :forward, transitive:)
    end

    def dependents(name, transitive: false)
      traverse(name, direction: :reverse, transitive:)
    end

    def callers(name, transitive: false)
      select_edges(
        dependents(name, transitive:),
        %w[call microflow_call nanoflow_call javascript_action_call]
      )
    end

    def callees(name, transitive: false)
      select_edges(
        dependencies(name, transitive:),
        %w[call microflow_call nanoflow_call javascript_action_call]
      )
    end

    def impact(name)
      dependents(name, transitive: true)
    end

    def to_h
      {
        schema_version: 1,
        nodes: @names.length,
        edges: edges.map(&:to_h)
      }
    end

    private

    def build_edges
      found = []
      @inventory.elements.each do |element|
        next unless element.qualified_name && element.details

        walk(
          element.details.reject { |key, _value| %w[mdl raw].include?(key) },
          source: element.qualified_name,
          path: [],
          found:
        )
        scan_mdl(element, found)
      end
      found.uniq { |edge| [edge.from, edge.to, edge.kind, edge.path] }
        .sort_by { |edge| [edge.from, edge.to, edge.kind, edge.path] }
    end

    def walk(value, source:, path:, found:)
      case value
      when Hash
        value.each do |key, child|
          walk(child, source:, path: [*path, key.to_s], found:)
        end
      when Array
        value.each_with_index do |child, index|
          walk(child, source:, path: [*path, index.to_s], found:)
        end
      when String
        references(value, path.last).each do |target|
          add_edge(source, target, path, found)
        end
      end
    end

    def references(value, key)
      matches = value.scan(/[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/)
        .select { |name| @qualified_names.include?(name) }
      if UNQUALIFIED_REFERENCE_KEYS.include?(key) && @names.include?(value)
        matches << value
      end
      matches.uniq
    end

    def scan_mdl(element, found)
      mdl = element.details["mdl"]
      return unless mdl

      references(mdl, nil).each do |target|
        add_edge(element.qualified_name, target, ["mdl"], found, kind: "mdl_reference")
      end
    end

    def add_edge(source, target, path, found, kind: nil)
      return if source == target

      key = path.reverse.find { |part| !part.match?(/\A\d+\z/) }
      found << Edge.new(
        from: source,
        to: target,
        kind: kind || KIND_KEYS.fetch(key, "reference"),
        path: path.join(".")
      )
    end

    def traverse(name, direction:, transitive:)
      raise ArgumentError, "unknown inventory element: #{name}" unless @names.include?(name)

      selected = []
      frontier = [name]
      visited = Set[name]
      loop do
        current = frontier.shift
        break unless current

        matches = edges.select do |edge|
          direction == :forward ? edge.from == current : edge.to == current
        end
        matches.each do |edge|
          selected << edge
          neighbor = direction == :forward ? edge.to : edge.from
          next unless transitive && visited.add?(neighbor)

          frontier << neighbor
        end
        break unless transitive || frontier.any?
      end
      selected.uniq { |edge| [edge.from, edge.to, edge.kind, edge.path] }
    end

    def select_edges(selected, kinds)
      selected.select { |edge| kinds.include?(edge.kind) }
    end
  end
end
