# frozen_string_literal: true

module MendixBridge
  class SecurityParser
    class << self
      def parse(type, description)
        case type
        when "projectsecurity" then parse_project_security(description)
        when "modulerole" then parse_module_role(description)
        when "userrole" then parse_user_role(description)
        else raise ArgumentError, "unsupported security element: #{type}"
        end
      end

      private

      def parse_project_security(description)
        settings = description.to_h do |entry|
          [entry.fetch("Property"), typed_value(entry["Value"])]
        end
        {
          "settings" => settings,
          "parse_status" => "parsed",
          "raw" => description
        }
      end

      def parse_module_role(description)
        mdl = description.fetch("mdl")
        {
          "description" => mdl[
            /\bmodule\s+role\s+[\w.]+\s+description\s+'((?:''|[^'])*)'/i, 1
          ]&.gsub("''", "'"),
          "included_in_user_roles" => mdl[
            /--\s*Included in user roles:\s*(.+)$/i, 1
          ]&.split(",")&.map(&:strip) || [],
          "mdl" => mdl,
          "parse_status" => "parsed"
        }
      end

      def parse_user_role(description)
        mdl = description.fetch("mdl")
        declaration = mdl.match(
          /create\s+user\s+role\s+(?<name>\w+)\s*\((?<module_roles>.*?)\)(?<management>.*?);/im
        )
        return { "mdl" => mdl, "parse_status" => "unsupported" } unless declaration

        management = declaration[:management].strip
        {
          "module_roles" => declaration[:module_roles].split(",").map(&:strip),
          "manage_all_roles" => management.match?(/\bmanage\s+all\s+roles\b/i),
          "manageable_roles" => management[
            /\bmanage\s+roles\s*\((.*?)\)/i, 1
          ]&.split(",")&.map(&:strip) || [],
          "check_security" => mdl.match?(/--\s*Check security:\s*enabled/i),
          "mdl" => mdl,
          "parse_status" => "parsed"
        }
      end

      def typed_value(value)
        case value
        when "true" then true
        when "false" then false
        when /\A\d+\z/ then value.to_i
        else value
        end
      end
    end
  end
end
