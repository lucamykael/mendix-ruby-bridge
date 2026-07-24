# frozen_string_literal: true

module MendixBridge
  class DomainParser
    class << self
      def parse(description)
        case description.fetch("type")
        when "entity" then parse_entity(description)
        when "association" then parse_association(description)
        else { "mdl" => description["mdl"] }
        end
      end

      private

      def parse_entity(description)
        mdl = description.fetch("mdl")
        declaration = mdl.match(
          /\b(?<kind>persistent|non-persistent|external)\s+entity\s+(?<name>[\w.]+)(?:\s+extends\s+(?<generalization>[\w.]+))?\s*\((?<body>.*?)\);/im
        )
        return { "mdl" => mdl, "parse_status" => "unsupported" } unless declaration

        {
          "kind" => declaration[:kind].downcase,
          "persistable" => declaration[:kind].casecmp?("persistent"),
          "generalization" => declaration[:generalization],
          "attributes" => parse_attributes(declaration[:body]),
          "access_rules" => parse_access_rules(mdl),
          "mdl" => mdl,
          "parse_status" => "parsed"
        }
      end

      def parse_attributes(body)
        body.lines.filter_map do |line|
          declaration = line.strip.delete_suffix(",")
          next if declaration.empty? || declaration.start_with?("@", "--")

          match = declaration.match(/\A(?<name>\w+):\s*(?<rest>.+)\z/)
          next unless match

          rest = match[:rest]
          default = rest[/\s+default\s+(.+)\z/i, 1]
          type = rest.sub(/\s+default\s+.+\z/i, "").sub(/\s+not\s+null\z/i, "")

          {
            "name" => match[:name],
            "type" => type,
            "required" => rest.match?(/\s+not\s+null(?:\s|\z)/i),
            "default" => default,
            "declaration" => declaration
          }.compact
        end
      end

      def parse_association(description)
        mdl = description.fetch("mdl")

        {
          "from" => mdl[/^from\s+(\S+)\s+to\s+\S+/i, 1],
          "to" => mdl[/^from\s+\S+\s+to\s+(\S+)/i, 1],
          "association_type" => mdl[/^type\s+([^;\s]+)/i, 1],
          "owner" => mdl[/^owner\s+([^;\s]+)/i, 1],
          "storage" => mdl[/^storage\s+([^;\s]+)/i, 1],
          "delete_behavior" => mdl[/^delete_behavior\s+([^;]+)/i, 1],
          "mdl" => mdl,
          "parse_status" => "parsed"
        }.compact
      end

      def parse_access_rules(mdl)
        mdl.lines.filter_map do |line|
          match = line.strip.match(
            /\Agrant\s+(?<role>[\w.]+)\s+on\s+(?<entity>[\w.]+)\s+\((?<permissions>.*)\)(?:\s+where\s+'(?<xpath>.*)')?;\z/i
          )
          next unless match

          permissions = match[:permissions]
          {
            "role" => match[:role],
            "create" => permission?(permissions, "create"),
            "delete" => permission?(permissions, "delete"),
            "read" => attribute_permission(permissions, "read"),
            "write" => attribute_permission(permissions, "write"),
            "xpath" => match[:xpath]&.gsub("''", "'")
          }.compact
        end
      end

      def permission?(permissions, name)
        permissions.match?(/(?:\A|,\s*)#{Regexp.escape(name)}(?:,|\z)/i)
      end

      def attribute_permission(permissions, name)
        match = permissions.match(/\b#{Regexp.escape(name)}\s+(\*|\([^)]*\))/i)
        return [] unless match
        return "*" if match[1] == "*"

        match[1].delete_prefix("(").delete_suffix(")").split(",").map(&:strip)
      end
    end
  end
end
