# frozen_string_literal: true

module MendixBridge
  class DocumentParser
    class << self
      def parse(type, description)
        mdl = description.fetch("mdl")
        details = case type
                  when "constant" then parse_constant(mdl)
                  when "javaaction" then parse_java_action(mdl)
                  when "importmapping", "exportmapping" then parse_mapping(mdl)
                  when "layout", "snippet" then parse_ui_document(type, mdl)
                  when "navprofile" then parse_navigation(mdl)
                  else {}
                  end

        details.merge("mdl" => mdl, "parse_status" => "parsed")
      end

      private

      def parse_constant(mdl)
        {
          "data_type" => mdl[/^\s*type\s+(.+)$/i, 1]&.strip,
          "default" => unquote(mdl[/^\s*default\s+(.+)$/i, 1]&.strip),
          "folder" => quoted_setting(mdl, "folder")
        }.compact
      end

      def parse_java_action(mdl)
        header = mdl.match(
          /\bjava\s+action\s+[\w.]+\s*\((?<parameters>.*?)\)\s*returns\s+(?<returns>\S+)/im
        )
        {
          "parameters" => parse_action_parameters(header&.[](:parameters).to_s),
          "return_type" => header&.[](:returns),
          "source_available" => !mdl.include?("source not available")
        }.compact
      end

      def parse_action_parameters(source)
        source.lines.filter_map do |line|
          match = line.strip.delete_suffix(",").match(
            /\A(\w+):\s*(.+?)(?:\s+(not null))?(?:\s*--\s*(.*))?\z/i
          )
          next unless match

          {
            "name" => match[1],
            "type" => match[2].strip,
            "required" => !match[3].nil?,
            "description" => match[4]
          }.compact
        end
      end

      def parse_mapping(mdl)
        {
          "direction" => mdl[/\bcreate\s+(import|export)\s+mapping\b/i, 1]&.downcase,
          "structure" => mdl[/\bwith\s+(?:json|xml)\s+structure\s+([\w.]+)/i, 1],
          "entities" => mdl.scan(
            /^\s*(?:create\s+)?([\w.]+)\s*\{\s*$/
          ).flatten.uniq,
          "attribute_mappings" => mdl.scan(
            /^\s*(\w+)\s*=\s*([\w.]+)\s*,?\s*$/
          ).map { |attribute, member| { "attribute" => attribute, "member" => member } }
        }.compact
      end

      def parse_ui_document(type, mdl)
        {
          "document_type" => type,
          "layout_type" => mdl[/^--\s*Layout Type:\s*(.+)$/i, 1]&.strip,
          "folder" => quoted_setting(mdl, "Folder"),
          "studio_pro_only" => mdl.match?(/cannot be created via MDL/i)
        }.compact
      end

      def parse_navigation(mdl)
        default_home = mdl.lines.filter_map do |line|
          match = line.match(/^\s*home\s+page\s+([\w.]+)(?:\s+for\s+[\w.]+)?/i)
          match[1] if match && !line.match?(/\s+for\s+[\w.]+/i)
        end.first
        {
          "kind" => mdl[/^--\s*Kind:\s*(.+)$/i, 1]&.strip,
          "home_page" => default_home,
          "role_home_pages" => mdl.scan(
            /^\s*home\s+page\s+([\w.]+)\s+for\s+([\w.]+)/i
          ).map { |page, role| { "role" => role, "page" => page } },
          "login_page" => mdl[/^\s*login\s+page\s+([\w.]+)/i, 1],
          "not_found_page" => mdl[/^\s*not\s+found\s+page\s+([\w.]+)/i, 1],
          "menu_groups" => mdl.scan(
            /^\s*menu\s+'((?:''|[^'])+)'\s*\(/i
          ).flatten.map { |caption| caption.gsub("''", "'") },
          "menu_items" => mdl.scan(
            /^\s*menu\s+item\s+'((?:''|[^'])+)'\s+(page|microflow|nanoflow)\s+([\w.]+)\s*;/i
          ).map do |caption, action, target|
            {
              "caption" => caption.gsub("''", "'"),
              "action" => action.downcase,
              "target" => target
            }
          end
        }.compact
      end

      def quoted_setting(mdl, name)
        value = mdl[/^\s*#{Regexp.escape(name)}\s+'((?:''|[^'])*)'/i, 1]
        value&.gsub("''", "'")
      end

      def unquote(value)
        return unless value
        return value unless value.start_with?("'") && value.end_with?("'")

        value[1...-1].gsub("''", "'")
      end
    end
  end
end
