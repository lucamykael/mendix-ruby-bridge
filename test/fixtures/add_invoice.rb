# frozen_string_literal: true

require_relative "../../lib/mendix_bridge"

MendixBridge.app("RubyBridgeSandbox", version: "11.6.8") do
  modulo "MyFirstModule" do
    entity "Invoice" do
      attribute "Number", :string
    end
  end
end
